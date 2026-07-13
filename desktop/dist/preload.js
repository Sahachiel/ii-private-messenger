"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    crypto: {
        generateIdentity: () => electron_1.ipcRenderer.invoke('crypto.generateIdentity'),
        encrypt: (peer, plaintext) => electron_1.ipcRenderer.invoke('crypto.encrypt', peer, plaintext),
        decrypt: (peer, cipherB64) => electron_1.ipcRenderer.invoke('crypto.decrypt', peer, cipherB64),
        buildSession: (peer, bundle) => electron_1.ipcRenderer.invoke('crypto.buildSession', peer, bundle),
        getIdentityPub: () => electron_1.ipcRenderer.invoke('crypto.getIdentityPub'),
        safetyNumber: (theirIk) => electron_1.ipcRenderer.invoke('crypto.safetyNumber', theirIk),
    },
    api: {
        session: () => electron_1.ipcRenderer.invoke('api.session'),
        register: (payload) => electron_1.ipcRenderer.invoke('api.register', payload),
        login: (username, password) => electron_1.ipcRenderer.invoke('api.login', username, password),
        logout: () => electron_1.ipcRenderer.invoke('api.logout'),
        searchUsers: (q) => electron_1.ipcRenderer.invoke('api.searchUsers', q),
        myCode: () => electron_1.ipcRenderer.invoke('api.myCode'),
        byCode: (code) => electron_1.ipcRenderer.invoke('api.byCode', code),
        getUserKeys: (id) => electron_1.ipcRenderer.invoke('api.getUserKeys', id),
        myNode: () => electron_1.ipcRenderer.invoke('api.myNode'),
    },
    groups: {
        create: (maxMembers) => electron_1.ipcRenderer.invoke('groups.create', maxMembers),
        list: () => electron_1.ipcRenderer.invoke('groups.list'),
        members: (gid) => electron_1.ipcRenderer.invoke('groups.members', gid),
        capability: (gid) => electron_1.ipcRenderer.invoke('groups.capability', gid),
        invite: (gid, opts) => electron_1.ipcRenderer.invoke('groups.invite', gid, opts),
        join: (token) => electron_1.ipcRenderer.invoke('groups.join', token),
        joinRequests: (gid) => electron_1.ipcRenderer.invoke('groups.joinRequests', gid),
        decide: (gid, userId, approve) => electron_1.ipcRenderer.invoke('groups.decide', gid, userId, approve),
        leave: (gid) => electron_1.ipcRenderer.invoke('groups.leave', gid),
    },
    senderKeys: {
        myDistribution: (gid, epoch) => electron_1.ipcRenderer.invoke('senderkeys.myDistribution', gid, epoch),
        processDistribution: (gid, d, realSender) => electron_1.ipcRenderer.invoke('senderkeys.processDistribution', gid, d, realSender),
        resolveSender: (sid) => electron_1.ipcRenderer.invoke('senderkeys.resolveSender', sid),
        opaqueSid: (gid, uid) => electron_1.ipcRenderer.invoke('senderkeys.opaqueSid', gid, uid),
        hasPeer: (gid, epoch, sid) => electron_1.ipcRenderer.invoke('senderkeys.hasPeer', gid, epoch, sid),
        encryptGroup: (gid, epoch, plaintext) => electron_1.ipcRenderer.invoke('senderkeys.encryptGroup', gid, epoch, plaintext),
        decryptGroup: (gid, m) => electron_1.ipcRenderer.invoke('senderkeys.decryptGroup', gid, m),
        rotateEpoch: (gid, newEpoch) => electron_1.ipcRenderer.invoke('senderkeys.rotateEpoch', gid, newEpoch),
    },
    socket: {
        connect: (relayUrl, accessToken) => electron_1.ipcRenderer.invoke('socket.connect', relayUrl, accessToken),
        send: (msg) => electron_1.ipcRenderer.invoke('socket.send', msg),
        disconnect: () => electron_1.ipcRenderer.invoke('socket.disconnect'),
        onMessage: (cb) => {
            const fn = (_, m) => cb(m);
            electron_1.ipcRenderer.on('socket.event', fn);
            return () => electron_1.ipcRenderer.removeListener('socket.event', fn);
        },
    },
};
electron_1.contextBridge.exposeInMainWorld('iimsg', api);
void {};
