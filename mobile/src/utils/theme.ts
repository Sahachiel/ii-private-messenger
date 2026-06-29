export const theme = {
  // Surfaces — deep navy with subtle warmth
  bg:       '#08091C',  // near-black with violet undertone
  bgElev:   '#10122B',  // card background
  bgCard:   '#171A3A',  // elevated surface
  bgInput:  '#0C0E24',  // input field
  border:   '#262A52',  // subtle violet border
  borderHi: '#3C4280',  // hover/focus border

  // Text
  text:     '#F2F4FA',
  textDim:  '#98A0C0',
  textMute: '#5A6088',

  // Accent — electric violet-cyan gradient pair
  accent:         '#7C5CFF',  // primary violet
  accentAlt:      '#22D3EE',  // cyan
  accentBubble:   'rgba(124,92,255,0.15)',
  accentGlow:     'rgba(124,92,255,0.35)',

  // Status
  alert:   '#FF4B6E',
  warning: '#FFB547',
  success: '#3DDC97',

  // Geometry
  radius:  14,
  radiusSm: 10,
  radiusLg: 20,
  spacing: (n: number) => n * 4,

  // Typography
  font: {
    regular: 'System',
    mono: 'Menlo',
    weightRegular: '400' as const,
    weightMedium:  '500' as const,
    weightSemi:    '600' as const,
    weightBold:    '700' as const,
    weightBlack:   '900' as const,
  },

  // Shadow presets
  shadow: {
    sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 2 },
    md: { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6 },
    glow: { shadowColor: '#7C5CFF', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12, elevation: 8 },
  },
} as const;

export type Theme = typeof theme;

// Chat wallpaper presets — linear-gradient pairs per chat background.
// User picks from these via ChatScreen header menu. Persisted per-conversation.
export interface WallpaperPreset { id: string; name: string; colors: [string, string]; noise?: boolean }
export const WALLPAPERS: readonly WallpaperPreset[] = [
  { id: 'default', name: 'Navy',     colors: ['#08091C', '#10122B'] },
  { id: 'violet',  name: 'Violet',   colors: ['#1A0E3A', '#08091C'] },
  { id: 'cyan',    name: 'Aurora',   colors: ['#0A1E3A', '#10122B'] },
  { id: 'emerald', name: 'Emerald',  colors: ['#0E2A22', '#08091C'] },
  { id: 'rose',    name: 'Rose',     colors: ['#2A0E1E', '#10122B'] },
  { id: 'mono',    name: 'Graphite', colors: ['#141414', '#080808'] },
] as const;

export function wallpaperById(id?: string): WallpaperPreset {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}
