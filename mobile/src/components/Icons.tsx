import React from 'react';
import Svg, { Path, Circle, Line } from 'react-native-svg';

interface IconProps { size?: number; color?: string; strokeWidth?: number }

const base = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none' } as const;

export const HomeIcon: React.FC<IconProps> = ({ size = 24, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
  </Svg>
);

export const ContactsIcon: React.FC<IconProps> = ({ size = 24, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const ShieldIcon: React.FC<IconProps> = ({ size = 24, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M12 2L4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    <Path d="M9 12l2 2 4-4" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
  </Svg>
);

export const SettingsIcon: React.FC<IconProps> = ({ size = 24, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
  </Svg>
);

export const SendIcon: React.FC<IconProps> = ({ size = 22, color = '#0A0E1A', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M22 2L11 13" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M22 2l-7 20-4-9-9-4 20-7z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
  </Svg>
);

export const SearchIcon: React.FC<IconProps> = ({ size = 20, color = '#8A95AA', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth={strokeWidth} />
    <Line x1="21" y1="21" x2="16.65" y2="16.65" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const ScanIcon: React.FC<IconProps> = ({ size = 22, color = '#0A0E1A', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const MicIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    <Path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const CameraIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    <Circle cx="12" cy="13" r="4" stroke={color} strokeWidth={strokeWidth} />
  </Svg>
);

export const ImageIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke={color} strokeWidth={strokeWidth} />
    <Circle cx="8.5" cy="8.5" r="1.5" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M21 15l-5-5L5 21" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
  </Svg>
);

export const FileIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    <Path d="M14 2v6h6" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
  </Svg>
);

export const SmileIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />
    <Circle cx="9" cy="10" r="0.8" fill={color} />
    <Circle cx="15" cy="10" r="0.8" fill={color} />
    <Path d="M8.5 14.5s1.5 2 3.5 2 3.5-2 3.5-2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const ReplyIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M9 14l-5-5 5-5" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    <Path d="M4 9h8a8 8 0 0 1 8 8v3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const ForwardIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M15 14l5-5-5-5" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    <Path d="M20 9h-8a8 8 0 0 0-8 8v3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const TrashIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const CopyIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M9 9h10v10H9zM5 5h10v4M5 5v10h4" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
  </Svg>
);

export const PlayIcon: React.FC<IconProps> = ({ size = 18, color = '#E6ECF5' }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M6 4l14 8-14 8z" fill={color} />
  </Svg>
);

export const PauseIcon: React.FC<IconProps> = ({ size = 18, color = '#E6ECF5' }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M6 4h4v16H6zM14 4h4v16h-4z" fill={color} />
  </Svg>
);

export const PlusIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Line x1="12" y1="5" x2="12" y2="19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="5" y1="12" x2="19" y2="12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const QRIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14h1v3M14 20h3v1M20 20h1v1" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
  </Svg>
);

export const StoryIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} strokeDasharray="3 2" />
    <Circle cx="12" cy="12" r="5" stroke={color} strokeWidth={strokeWidth} />
  </Svg>
);

export const GroupIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Circle cx="9" cy="8" r="3.5" stroke={color} strokeWidth={strokeWidth} />
    <Circle cx="17" cy="9" r="3" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6M15 14c3 0 7 1.5 7 5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const LocationIcon: React.FC<IconProps> = ({ size = 22, color = '#E6ECF5', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    <Circle cx="12" cy="9" r="2.5" stroke={color} strokeWidth={strokeWidth} />
  </Svg>
);

export const ClockIcon: React.FC<IconProps> = ({ size = 18, color = '#8A95AA', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M12 7v5l3 2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const CheckIcon: React.FC<IconProps> = ({ size = 14, color = '#8A95AA', strokeWidth = 2 }) => (
  <Svg {...base} width={size} height={size}>
    <Path d="M4 13l5 5L20 6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const CheckDoubleIcon: React.FC<IconProps> = ({ size = 14, color = '#8A95AA', strokeWidth = 2 }) => (
  <Svg width={size} height={size} viewBox="0 0 30 24" fill="none">
    <Path d="M1 13l5 5L17 6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M11 13l5 5L27 6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
