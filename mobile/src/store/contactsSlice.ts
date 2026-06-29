import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { contactsApi, usersApi } from '@services/api';
import { Contact, User } from '../types';

export interface ContactsState {
  contacts: Contact[];
  blocked: Contact[];
  searchResults: User[];
  loading: boolean;
  error: string | null;
}

const initial: ContactsState = {
  contacts: [], blocked: [], searchResults: [], loading: false, error: null,
};

export const loadContacts = createAsyncThunk('contacts/load', async () => contactsApi.list());
export const addContact = createAsyncThunk('contacts/add', async (userId: string) => contactsApi.add(userId));
export const removeContact = createAsyncThunk('contacts/remove', async (id: string) => { await contactsApi.remove(id); return id; });
export const blockUser = createAsyncThunk('contacts/block', async (id: string) => { await contactsApi.block(id); return id; });
export const unblockUser = createAsyncThunk('contacts/unblock', async (id: string) => { await contactsApi.unblock(id); return id; });
export const searchUsers = createAsyncThunk('contacts/search', async (q: string) => usersApi.search(q));

const slice = createSlice({
  name: 'contacts',
  initialState: initial,
  reducers: {
    clearSearch(state) { state.searchResults = []; },
  },
  extraReducers: (b) => {
    b.addCase(loadContacts.pending, (s) => { s.loading = true; })
     .addCase(loadContacts.fulfilled, (s, a) => {
        s.loading = false;
        s.contacts = a.payload.filter((c) => !c.isBlocked);
        s.blocked = a.payload.filter((c) => !!c.isBlocked);
     })
     .addCase(loadContacts.rejected, (s, a) => { s.loading = false; s.error = a.error.message ?? null; })
     .addCase(addContact.fulfilled, (s, a) => { s.contacts.push(a.payload); })
     .addCase(removeContact.fulfilled, (s, a) => {
        s.contacts = s.contacts.filter((c) => c.id !== a.payload);
     })
     .addCase(blockUser.fulfilled, (s, a) => {
        const c = s.contacts.find((x) => x.id === a.payload);
        if (c) { s.contacts = s.contacts.filter((x) => x.id !== a.payload); s.blocked.push({ ...c, isBlocked: true }); }
     })
     .addCase(unblockUser.fulfilled, (s, a) => {
        const c = s.blocked.find((x) => x.id === a.payload);
        if (c) { s.blocked = s.blocked.filter((x) => x.id !== a.payload); s.contacts.push({ ...c, isBlocked: false }); }
     })
     .addCase(searchUsers.fulfilled, (s, a) => { s.searchResults = a.payload; });
  },
});

export const { clearSearch } = slice.actions;
export default slice.reducer;
