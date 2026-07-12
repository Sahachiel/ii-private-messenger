export const theme = {
  // Surfaces — tema CHIARO stile WhatsApp
  bg:       '#FFFFFF',  // sfondo schermi/liste
  bgElev:   '#F0F2F5',  // barre (header/composer/sheet)
  bgCard:   '#F5F6F6',  // card/avatar
  bgInput:  '#FFFFFF',  // input field
  border:   '#E9EDEF',  // bordo tenue
  borderHi: '#D1D7DB',  // hover/focus border

  // Text
  text:     '#111B21',
  textDim:  '#667781',
  textMute: '#8696A0',

  // Accent — verde WhatsApp
  accent:         '#00A884',  // verde primario (send/FAB/attivi)
  accentAlt:      '#53BDEB',  // blu (tick 'letto')
  accentBubble:   'rgba(0,168,132,0.12)',
  accentGlow:     'rgba(0,168,132,0.22)',

  // Status
  alert:   '#EA4335',
  warning: '#FFB547',
  success: '#25D366',

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

  // Shadow presets (tenui per tema chiaro)
  shadow: {
    sm: { shadowColor: '#0B141A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.10, shadowRadius: 3, elevation: 1 },
    md: { shadowColor: '#0B141A', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 4 },
    glow: { shadowColor: '#00A884', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.30, shadowRadius: 10, elevation: 6 },
  },
} as const;

export type Theme = typeof theme;

// Chat wallpaper presets — sfondo chat. Default = beige WhatsApp.
export interface WallpaperPreset { id: string; name: string; colors: [string, string]; noise?: boolean }
export const WALLPAPERS: readonly WallpaperPreset[] = [
  { id: 'default', name: 'Chiaro',   colors: ['#EFEAE2', '#EFEAE2'] },
  { id: 'mint',    name: 'Menta',    colors: ['#E7F3EC', '#DDECE3'] },
  { id: 'sand',    name: 'Sabbia',   colors: ['#F3EEE4', '#EAE2D3'] },
  { id: 'gray',    name: 'Grigio',   colors: ['#F0F2F5', '#E9EDEF'] },
  { id: 'sky',     name: 'Cielo',    colors: ['#E8F1FB', '#DCEBF7'] },
  { id: 'rose',    name: 'Rosa',     colors: ['#FBEDEF', '#F5E1E6'] },
] as const;

export function wallpaperById(id?: string): WallpaperPreset {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}
