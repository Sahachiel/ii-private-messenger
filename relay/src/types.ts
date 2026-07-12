import { z } from 'zod';

export type Region = 'ru' | 'ge' | 'fi';

export const AuthMessageSchema = z.object({
  type: z.literal('auth'),
  token: z.string().min(1),
});
export type AuthMessage = z.infer<typeof AuthMessageSchema>;

// Client -> Relay messages (SPEC PART 5)
export const SendMessageSchema = z.object({
  type: z.literal('send_message'),
  messageId: z.string(),
  to: z.string(),
  conversationId: z.string(),
  ciphertext: z.string(),
  messageType: z.string().optional(),
  timestamp: z.number().optional(),
  // Gruppi isolati: gid + epoch + capability firmata dal backend (verificata dal relay).
  gid: z.string().optional(),
  epoch: z.number().optional(),
  cap: z.string().optional(),
});
export const CallOfferSchema = z.object({
  type: z.literal('call_offer'),
  callId: z.string(),
  to: z.string(),
  callType: z.enum(['voice', 'video']),
  sdp: z.string(),
});
export const CallAnswerSchema = z.object({
  type: z.literal('call_answer'),
  callId: z.string(),
  to: z.string(),
  sdp: z.string(),
});
export const IceCandidateSchema = z.object({
  type: z.literal('ice_candidate'),
  callId: z.string(),
  to: z.string(),
  candidate: z.unknown(),
});
export const CallEndSchema = z.object({
  type: z.literal('call_end'),
  callId: z.string(),
  to: z.string(),
  reason: z.string().optional(),
});
export const TypingStartSchema = z.object({
  type: z.literal('typing_start'),
  to: z.string(),
  conversationId: z.string(),
  gid: z.string().optional(),
  cap: z.string().optional(),
});
export const TypingStopSchema = z.object({
  type: z.literal('typing_stop'),
  to: z.string(),
  conversationId: z.string(),
  gid: z.string().optional(),
  cap: z.string().optional(),
});
export const ReadReceiptSchema = z.object({
  type: z.literal('read_receipt'),
  to: z.string(),
  messageId: z.string(),
  conversationId: z.string(),
  gid: z.string().optional(),
  cap: z.string().optional(),
});
export const PingSchema = z.object({
  type: z.literal('ping'),
  ts: z.number().optional(),
});
// Richiesta di contatto "seamless": chi aggiunge-per-codice crea un gruppo + invito bound e
// recapita il token al destinatario via relay (instradato per `to`, senza gid, come le chiamate).
// Il destinatario mostra "X vuole contattarti" → Accetta → groups.join(token).
export const ContactInviteSchema = z.object({
  type: z.literal('contact_invite'),
  to: z.string(),
  token: z.string(),
  fromName: z.string().optional(),
  fromCode: z.string().optional(),
});

export const RelayMessageSchema = z.discriminatedUnion('type', [
  SendMessageSchema,
  CallOfferSchema,
  CallAnswerSchema,
  IceCandidateSchema,
  CallEndSchema,
  TypingStartSchema,
  TypingStopSchema,
  ReadReceiptSchema,
  ContactInviteSchema,
  PingSchema,
]);
export type RelayMessage = z.infer<typeof RelayMessageSchema>;

export type RelayEventType =
  | 'message'
  | 'delivery_receipt'
  | 'read_receipt'
  | 'call_offer'
  | 'call_answer'
  | 'ice_candidate'
  | 'call_end'
  | 'typing_start'
  | 'typing_stop'
  | 'contact_invite'
  | 'presence'
  | 'pong'
  | 'error';

export interface RelayEventBase {
  type: RelayEventType;
  from?: string;
  to?: string;
  messageId?: string;
  conversationId?: string;
  gid?: string;
  epoch?: number;
  ciphertext?: string;
  messageType?: string;
  timestamp?: number;
  callId?: string;
  callType?: 'voice' | 'video';
  sdp?: string;
  candidate?: unknown;
  reason?: string;
  status?: 'online' | 'offline';
  userId?: string;
  ts?: number;
  error?: string;
  token?: string;
  fromName?: string;
  fromCode?: string;
}

export type RelayEvent = RelayEventBase;

// Cross-region forwarded payload
export const InternalForwardSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
  messageId: z.string().optional(),
  conversationId: z.string().optional(),
  gid: z.string().optional(),
  epoch: z.number().optional(),
  ciphertext: z.string().optional(),
  messageType: z.string().optional(),
  timestamp: z.number().optional(),
  callId: z.string().optional(),
  callType: z.enum(['voice', 'video']).optional(),
  sdp: z.string().optional(),
  candidate: z.unknown().optional(),
  reason: z.string().optional(),
});
export type InternalForward = z.infer<typeof InternalForwardSchema>;

export interface VerifiedUser {
  userId: string;
  username: string;
  region: Region;
}
