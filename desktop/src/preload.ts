import { contextBridge, ipcRenderer } from 'electron';

type Invoke = <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;

const api = {
  crypto: {
    generateIdentity: () => ipcRenderer.invoke('crypto.generateIdentity'),
    encrypt: (peer: string, plaintext: string) => ipcRenderer.invoke('crypto.encrypt', peer, plaintext),
    decrypt: (peer: string, cipherB64: string) => ipcRenderer.invoke('crypto.decrypt', peer, cipherB64),
    buildSession: (peer: string, bundle: unknown) => ipcRenderer.invoke('crypto.buildSession', peer, bundle),
    getIdentityPub: () => ipcRenderer.invoke('crypto.getIdentityPub'),
    safetyNumber: (theirIk: string) => ipcRenderer.invoke('crypto.safetyNumber', theirIk),
  },
  api: {
    session: () => ipcRenderer.invoke('api.session'),
    register: (payload: unknown) => ipcRenderer.invoke('api.register', payload),
    login: (username: string, password: string) => ipcRenderer.invoke('api.login', username, password),
    logout: () => ipcRenderer.invoke('api.logout'),
    searchUsers: (q: string) => ipcRenderer.invoke('api.searchUsers', q),
    myCode: () => ipcRenderer.invoke('api.myCode'),
    byCode: (code: string) => ipcRenderer.invoke('api.byCode', code),
    getUserKeys: (id: string) => ipcRenderer.invoke('api.getUserKeys', id),
    myNode: () => ipcRenderer.invoke('api.myNode'),
  },
  groups: {
    create: (maxMembers?: number) => ipcRenderer.invoke('groups.create', maxMembers),
    list: () => ipcRenderer.invoke('groups.list'),
    members: (gid: string) => ipcRenderer.invoke('groups.members', gid),
    capability: (gid: string) => ipcRenderer.invoke('groups.capability', gid),
    invite: (gid: string, opts: unknown) => ipcRenderer.invoke('groups.invite', gid, opts),
    join: (token: string) => ipcRenderer.invoke('groups.join', token),
    joinRequests: (gid: string) => ipcRenderer.invoke('groups.joinRequests', gid),
    decide: (gid: string, userId: string, approve: boolean) => ipcRenderer.invoke('groups.decide', gid, userId, approve),
    leave: (gid: string) => ipcRenderer.invoke('groups.leave', gid),
  },
  senderKeys: {
    myDistribution: (gid: string, epoch: number) => ipcRenderer.invoke('senderkeys.myDistribution', gid, epoch),
    processDistribution: (gid: string, d: unknown, realSender: string) => ipcRenderer.invoke('senderkeys.processDistribution', gid, d, realSender),
    resolveSender: (sid: string) => ipcRenderer.invoke('senderkeys.resolveSender', sid),
    opaqueSid: (gid: string, uid: string) => ipcRenderer.invoke('senderkeys.opaqueSid', gid, uid),
    hasPeer: (gid: string, epoch: number, sid: string) => ipcRenderer.invoke('senderkeys.hasPeer', gid, epoch, sid),
    encryptGroup: (gid: string, epoch: number, plaintext: string) => ipcRenderer.invoke('senderkeys.encryptGroup', gid, epoch, plaintext),
    decryptGroup: (gid: string, m: unknown) => ipcRenderer.invoke('senderkeys.decryptGroup', gid, m),
    rotateEpoch: (gid: string, newEpoch: number) => ipcRenderer.invoke('senderkeys.rotateEpoch', gid, newEpoch),
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
