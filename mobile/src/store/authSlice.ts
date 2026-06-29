import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { authApi, regionApi, setAccessToken } from '@services/api';
import { KC, appKv } from '@services/keychain';
import { signal } from '@services/signal';
import { socket } from '@services/socket';
import { getRegionForCountry } from '@utils/countries';
import { transport } from '@services/transport';
import { User, Region, TurnConfig, ProxyConfig } from '../types';

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  region: Region | null;
  relayUrl: string | null;
  turnConfig: TurnConfig | null;
  proxyConfig: ProxyConfig | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  // true until restoreSession resolves — RootNavigator shows splash instead of AuthStack
  bootstrapping: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null, accessToken: null, refreshToken: null, region: null,
  relayUrl: null, turnConfig: null, proxyConfig: null, isAuthenticated: false, isLoading: false,
  bootstrapping: true, error: null,
};

export const registerUser = createAsyncThunk(
  'auth/register',
  async (args: { username: string; displayName: string; password: string; phone?: string; countryCode: string }, { rejectWithValue }) => {
    try {
      await signal.initialize();
      const bundle = await signal.generateKeyBundle();
      const res = await authApi.register({
        username: args.username, displayName: args.displayName, password: args.password,
        phone: args.phone, countryCode: args.countryCode,
        identityPublicKey: bundle.identityPublicKey,
        signedPreKey: bundle.signedPreKey,
        registrationId: bundle.registrationId,
        oneTimePreKeys: bundle.oneTimePreKeys,
      });
      setAccessToken(res.accessToken);
      await KC.setToken(res.refreshToken);
      await KC.setCreds(args.username, args.password);
      persistUserSnapshot(res.user);
      // Avvia il transport anti-censura PRIMA delle connessioni successive (myNode, socket),
      // così passano già nel tunnel quando l'utente è in region ru o ha il toggle attivo.
      await transport.maybeAutoStart(res.user.region, res.proxyConfig ?? null);
      try {
        const node = await regionApi.myNode();
        res.turnConfig = node.turnConfig;
        res.relayUrl = node.relayUrl;
        if (node.proxyConfig) res.proxyConfig = node.proxyConfig;
      } catch {}
      socket.connect(res.relayUrl, res.accessToken);
      return res;
    } catch (e: any) { return rejectWithValue(e?.message ?? 'register_failed'); }
  },
);

export const loginUser = createAsyncThunk(
  'auth/login',
  async (args: { username: string; password: string }, { rejectWithValue }) => {
    try {
      const res = await authApi.login(args.username, args.password);
      setAccessToken(res.accessToken);
      await KC.setToken(res.refreshToken);
      await KC.setCreds(args.username, args.password);
      await signal.initialize();
      persistUserSnapshot(res.user);
      // Avvia il transport anti-censura PRIMA delle connessioni successive (myNode, socket),
      // così passano già nel tunnel quando l'utente è in region ru o ha il toggle attivo.
      await transport.maybeAutoStart(res.user.region, res.proxyConfig ?? null);
      try {
        const node = await regionApi.myNode();
        res.turnConfig = node.turnConfig;
        res.relayUrl = node.relayUrl;
        if (node.proxyConfig) res.proxyConfig = node.proxyConfig;
      } catch {}
      socket.connect(res.relayUrl, res.accessToken);
      return res;
    } catch (e: any) { return rejectWithValue(e?.message ?? 'login_failed'); }
  },
);

// Minimal snapshot persisted so restoreSession can rebuild `user` without a /users/me call.
function persistUserSnapshot(u: User): void {
  appKv.set('auth.userId', u.id);
  appKv.set('auth.username', u.username);
  if (u.displayName) appKv.set('auth.displayName', u.displayName);
  if (u.countryCode) appKv.set('auth.countryCode', u.countryCode);
  if (u.region) appKv.set('auth.region', u.region);
}

// Boot flow: read persisted user + refresh token → refresh access token → rehydrate region/socket.
// On failure the user is sent to the Auth stack; no silent retry loop.
export const restoreSession = createAsyncThunk(
  'auth/restore',
  async (_: void, { rejectWithValue }) => {
    const userId = appKv.getString('auth.userId');
    const username = appKv.getString('auth.username');
    if (!userId || !username) return rejectWithValue('no_user');

    const tok = await KC.getToken();
    if (!tok || !tok.password) return rejectWithValue('no_token');

    const ok = await authApi.refresh();
    if (!ok) return rejectWithValue('refresh_failed');
    const accessToken = authApi.getAccessToken();
    if (!accessToken) return rejectWithValue('no_access_token');

    try { await signal.initialize(); } catch {}

    const displayName = appKv.getString('auth.displayName') ?? username;
    const countryCode = appKv.getString('auth.countryCode') ?? '';
    const persistedRegion = (appKv.getString('auth.region') as Region | undefined) ?? getRegionForCountry(countryCode);

    let relayUrl: string | null = null;
    let turnConfig: TurnConfig | null = null;
    let proxyConfig: ProxyConfig | null = null;
    let region: Region = persistedRegion;
    // La region è già nota dal boot persistito → avvia il transport (con l'ultima config
    // salvata) prima di myNode/socket se l'utente è in region ru o ha il toggle attivo.
    await transport.maybeAutoStart(persistedRegion, null);
    try {
      const node = await regionApi.myNode();
      relayUrl = node.relayUrl;
      turnConfig = node.turnConfig;
      proxyConfig = node.proxyConfig;
      region = node.region;
    } catch {}

    socket.connect(relayUrl ?? undefined as any, accessToken);

    const user: User = { id: userId, username, displayName, countryCode, region };
    return { user, accessToken, refreshToken: tok.password, relayUrl, turnConfig, proxyConfig, region };
  },
);

export const biometricLogin = createAsyncThunk(
  'auth/biometric',
  async (_: void, { rejectWithValue, dispatch }) => {
    const creds = await KC.getCreds();
    if (!creds) return rejectWithValue('no_creds');
    return dispatch(loginUser({ username: creds.username, password: creds.password })).unwrap();
  },
);

export const logoutUser = createAsyncThunk('auth/logout', async () => {
  try { await authApi.logout(); } catch {}
  socket.disconnect();
  setAccessToken(null);
  await KC.clearToken();
  await KC.clearCreds();
  await KC.clearIdentity();
  appKv.clearAll();
});

export const refreshMyRegion = createAsyncThunk('auth/region', async () => regionApi.myNode());

const slice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    updateProfile(state, a: PayloadAction<Partial<User>>) {
      if (state.user) state.user = { ...state.user, ...a.payload };
    },
    clearError(state) { state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(registerUser.pending, (s) => { s.isLoading = true; s.error = null; })
     .addCase(registerUser.fulfilled, (s, a) => {
        s.isLoading = false; s.isAuthenticated = true; s.bootstrapping = false;
        s.user = a.payload.user; s.accessToken = a.payload.accessToken; s.refreshToken = a.payload.refreshToken;
        s.region = a.payload.user.region; s.relayUrl = a.payload.relayUrl; s.turnConfig = a.payload.turnConfig;
        s.proxyConfig = a.payload.proxyConfig ?? null;
     })
     .addCase(registerUser.rejected, (s, a) => { s.isLoading = false; s.error = String(a.payload ?? a.error.message); })
     .addCase(loginUser.pending, (s) => { s.isLoading = true; s.error = null; })
     .addCase(loginUser.fulfilled, (s, a) => {
        s.isLoading = false; s.isAuthenticated = true; s.bootstrapping = false;
        s.user = a.payload.user; s.accessToken = a.payload.accessToken; s.refreshToken = a.payload.refreshToken;
        s.region = a.payload.user.region ?? getRegionForCountry(a.payload.user.countryCode);
        s.relayUrl = a.payload.relayUrl; s.turnConfig = a.payload.turnConfig;
        s.proxyConfig = a.payload.proxyConfig ?? null;
     })
     .addCase(loginUser.rejected, (s, a) => { s.isLoading = false; s.error = String(a.payload ?? a.error.message); })
     .addCase(restoreSession.fulfilled, (s, a) => {
        s.bootstrapping = false; s.isAuthenticated = true;
        s.user = a.payload.user;
        s.accessToken = a.payload.accessToken;
        s.refreshToken = a.payload.refreshToken;
        s.region = a.payload.region;
        s.relayUrl = a.payload.relayUrl;
        s.turnConfig = a.payload.turnConfig;
        s.proxyConfig = a.payload.proxyConfig;
     })
     .addCase(restoreSession.rejected, (s) => { s.bootstrapping = false; })
     .addCase(logoutUser.fulfilled, () => ({ ...initialState, bootstrapping: false }))
     .addCase(refreshMyRegion.fulfilled, (s, a) => {
        s.region = a.payload.region; s.relayUrl = a.payload.relayUrl; s.turnConfig = a.payload.turnConfig;
        s.proxyConfig = a.payload.proxyConfig ?? null;
     });
  },
});

export const { updateProfile, clearError } = slice.actions;
export default slice.reducer;
