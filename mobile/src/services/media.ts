import { launchImageLibrary, launchCamera, Asset } from 'react-native-image-picker';
import { Buffer } from 'buffer';
import { MediaRef } from '../types';

// Max inline media size in envelope. 1.5 MB base64 ≈ 1.1 MB raw — keeps pushes
// reliable on the relay and fits within a single WS frame for most cases.
export const MAX_INLINE_MEDIA_BYTES = 1_500_000;

type PickOpts = { source: 'library' | 'camera'; kind: 'image' | 'video' };

export async function pickMedia(opts: PickOpts): Promise<MediaRef | null> {
  const fn = opts.source === 'camera' ? launchCamera : launchImageLibrary;
  const r = await fn({
    mediaType: opts.kind === 'video' ? 'video' : 'photo',
    includeBase64: true,
    quality: 0.82,
    maxWidth: 1600,
    maxHeight: 1600,
    videoQuality: 'medium',
    selectionLimit: 1,
  });
  if (r.didCancel || !r.assets || r.assets.length === 0) return null;
  const a: Asset = r.assets[0];
  if (!a.base64 || !a.type) return null;
  if ((a.fileSize ?? 0) > MAX_INLINE_MEDIA_BYTES) {
    // soft-cap: reject too-large media (inline encoding only for v0.2.5)
    throw new Error('Media too large (max 1.5 MB). Send a smaller file.');
  }
  return {
    mime: a.type,
    data: a.base64,
    size: a.fileSize,
    width: a.width,
    height: a.height,
    durationMs: a.duration ? Math.round(a.duration * 1000) : undefined,
  };
}

export function mediaDataUri(m: MediaRef): string {
  return `data:${m.mime};base64,${m.data}`;
}

// Render a short label for ConversationItem preview when last message is media.
export function mediaPreviewLabel(kind: string): string {
  switch (kind) {
    case 'image': return 'Photo';
    case 'video': return 'Video';
    case 'voice': return 'Voice message';
    case 'file':  return 'File';
    case 'location': return 'Location';
    default: return '';
  }
}
