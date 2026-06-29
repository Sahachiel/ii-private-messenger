import { contextBridge, ipcRenderer } from 'electron';

type Invoke = <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;

const api = {
  crypto: {
    generateIdentity: () => ipcRenderer.invoke('crypto.generateIdentity'),
    encrypt: (peer: string, plaintext: string) => ipcRenderer.invoke('crypto.encrypt', peer, plaintext),
    decrypt: (peer: string, cipherB64: string) => ipcRenderer.invoke('crypto.decrypt', peer, cipherB64),
    buildSession: (peer: string, theirPubB64: string) => ipcRenderer.invoke('crypto.buildSession', peer, theirPubB64),
    getIdentityPub: () => ipcRenderer.invoke('crypto.getIdentityPub'),
  },
  api: {
    session: () => ipcRenderer.invoke('api.session'),
    register: (payload: unknown) => ipcRenderer.invoke('api.register', payload),
    login: (username: string, password: string) => ipcRenderer.invoke('api.login', username, password),
    logout: () => ipcRenderer.invoke('api.logout'),
    searchUsers: (q: string) => ipcRenderer.invoke('api.searchUsers', q),
    getUserKeys: (id: string) => ipcRenderer.invoke('api.getUserKeys', id),
    myNode: () => ipcRenderer.invoke('api.myNode'),
  },
  socket: {
    connect: (relayUrl: string, accessToken: string) => ipcRenderer.invoke('socket.connect', relayUrl, accessToken),
    send: (msg: unknown) => ipcRenderer.invoke('socket.send', msg),
    disconnect: () => ipcRenderer.invoke('socket.disconnect'),
    onMessage: (cb: (m: unknown) => void) => {
      const fn = (_: unknown, m: unknown): void => cb(m);
      ipcRenderer.on('socket.event', fn);
      return () => ipcRenderer.removeListener('socket.event', fn);
    },
  },
} as const;

contextBridge.exposeInMainWorld('iimsg', api);

export type IIMsgApi = typeof api;
void ({} as Invoke);
