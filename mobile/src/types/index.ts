export type Region = 'ru' | 'ge' | 'fi';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  countryCode: string;
  region: Region;
  phone?: string;
  lastSeen?: string;
  isActive?: boolean;
}

export interface Contact extends User {
  nickname?: string;
  isBlocked?: boolean;
}

export interface KeyBundle {
  identityPublicKey: string;
  signedPreKey: { keyId: number; publicKey: string; signature: string };
  registrationId: number;
  oneTimePreKeys: { keyId: number; publicKey: string }[];
}

export interface RemoteKeyBundle {
  identityPublicKey: string;
  signedPreKey: { keyId: number; publicKey: string; signature: string };
  oneTimePreKey?: { keyId: number; publicKey: string };
  registrationId: number;
}

export interface EncryptedPayload {
  type: number;
  ciphertext: string;
  preKeyId?: number;
  signedPreKeyId?: number;
  registrationId?: number;
}

export type MessageType = 'text' | 'image' | 'file' | 'audio' | 'video' | 'call_log' | 'voice' | 'location' | 'story_ack' | 'reaction' | 'system';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ReplyRef {
  id: string;
  senderId: string;
  preview: string; // short excerpt, stripped of media
  kind: MessageType;
}

// emoji → list of userIds who reacted. Single reaction per user per message enforced client-side.
export type Reactions = Record<string, string[]>;

export interface MediaRef {
  mime: string;
  // inline base64 for small media (<2MB). For larger → blob upload (v0.3).
  data?: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number; // voice/video
  thumbnail?: string;  // base64 preview
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  type: MessageType;
  body: string;
  ciphertext?: EncryptedPayload;
  sentAt: number;
  deliveredAt?: number;
  readAt?: number;
  expiresAt?: number; // disappearing messages — client-side delete on this ts
  status: MessageStatus;
  replyTo?: ReplyRef;
  reactions?: Reactions;
  media?: MediaRef;
  groupId?: string;
  // true when this message was decrypted from a sender attestation flagged compromised
  senderCompromised?: boolean;
}

export interface Conversation {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  isGroup: boolean;
  lastMessage?: Message;
  unreadCount: number;
  muted: boolean;
  archived: boolean;
  updatedAt: number;
  // per-chat disappearing timer (ms). Outgoing messages get expiresAt = now+ttl.
  disappearingMs?: number;
  // wallpaper preset id for this chat; undefined = default theme.bg
  wallpaperId?: string;
  // typing preview (non-persistent UX hint, not serialized).
  peerTyping?: boolean;
}

export interface Group {
  id: string;
  name: string;
  iconUrl?: string;
  memberIds: string[]; // includes self
  adminIds: string[];
  createdAt: number;
  createdBy: string;
}

export type StoryKind = 'image' | 'text';
export interface Story {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  kind: StoryKind;
  body: string; // text content, or base64 image
  bgColor?: string; // for text stories
  createdAt: number;
  expiresAt: number; // now + 24h
  viewedBy: string[]; // recipients who've opened it
}

export type TrustLevel = 'secure' | 'warning' | 'compromised' | 'unknown';
export interface PeerTrust {
  peerId: string;
  level: TrustLevel;
  score: number; // 0..100
  lastUpdated: number;
  detectorDigest?: string;
}

export type CallType = 'voice' | 'video';
export type CallStatus = 'idle' | 'dialing' | 'ringing' | 'connected' | 'reconnecting' | 'ended';

export interface ActiveCall {
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  type: CallType;
  status: CallStatus;
  startedAt?: number;
  isOutgoing: boolean;
}

export interface TurnConfig {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
}

/**
 * Config del transport anti-censura (VLESS + XTLS-Vision + REALITY) consegnata dal
 * backend agli utenti in region soggetta a censura (ru). L'app la usa per avviare il
 * proprio tunnel per-app verso il VPS REALITY. pbk/sid/sni sono pubblici; uuid è la
 * credenziale di accesso.
 */
export interface ProxyConfig {
  server: string;
  port: number;
  uuid: string;
  pbk: string;
  sid: string;
  sni: string;
  flow: string;
  fp: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  relayUrl: string;
  turnConfig: TurnConfig;
  proxyConfig?: ProxyConfig | null;
}

// Matches backend/relay/src/types.ts discriminated union.
export type RelayMessage =
  | { type: 'auth'; token: string }
  | { type: 'send_message'; messageId: string; to: string; conversationId: string; ciphertext: string; messageType?: string; timestamp?: number; gid?: string; epoch?: number; cap?: string }
  | { type: 'call_offer'; callId: string; to: string; callType: CallType; sdp: string }
  | { type: 'call_answer'; callId: string; to: string; sdp: string }
  | { type: 'ice_candidate'; callId: string; to: string; candidate: any }
  | { type: 'call_end'; callId: string; to: string; reason?: string }
  | { type: 'typing_start'; to: string; conversationId: string; gid?: string; cap?: string }
  | { type: 'typing_stop'; to: string; conversationId: string; gid?: string; cap?: string }
  | { type: 'read_receipt'; to: string; messageId: string; conversationId: string; gid?: string; cap?: string }
  | { type: 'ping'; ts?: number };

export interface RelayEvent {
  type: 'message' | 'delivery_receipt' | 'read_receipt' | 'call_offer' | 'call_answer'
      | 'ice_candidate' | 'call_end' | 'typing_start' | 'typing_stop' | 'presence' | 'pong' | 'error';
  from?: string; to?: string;
  messageId?: string; conversationId?: string;
  gid?: string; epoch?: number;
  ciphertext?: string; messageType?: string; timestamp?: number;
  callId?: string; callType?: CallType; sdp?: string; candidate?: any;
  reason?: string;
  status?: 'online' | 'offline'; userId?: string;
  ts?: number; error?: string;
}
