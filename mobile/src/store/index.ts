import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import auth from './authSlice';
import chat from './chatSlice';
import call from './callSlice';
import contacts from './contactsSlice';
import stories from './storiesSlice';
import groups from './groupsSlice';

export const store = configureStore({
  reducer: { auth, chat, call, contacts, stories, groups },
  middleware: (getDefault) => getDefault({ serializableCheck: false }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
