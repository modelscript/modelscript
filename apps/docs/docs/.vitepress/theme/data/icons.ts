// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Minimal stroke icon set (24×24, Lucide-compatible geometry, ISC-licensed shapes)
 * paired with true two-tone duotone layer definitions (`ICON_DUOTONE`).
 * Rendered by `MsIcon.vue`. Kept as plain strings so the set is tree-shake friendly
 * and usable from both Vue components and Node-side config.
 */
export const ICONS = {
  plane:
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  train:
    '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  anchor: '<path d="M12 22V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><circle cx="12" cy="5" r="3"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  flame:
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  atom: '<circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/>',
  building:
    '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  flask:
    '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  dna: '<path d="m10 16 1.5 1.5"/><path d="m14 8-1.5-1.5"/><path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993"/><path d="m16.5 10.5 1 1"/><path d="m17 6-2.891-2.891"/><path d="M2 15c6.667-6 13.333 0 20-6"/><path d="m20 9 .891.891"/><path d="M3.109 14.109 4 15"/><path d="m6.5 12.5 1 1"/><path d="m7 18 2.891 2.891"/><path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993"/>',
  layers:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  activity:
    '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  workflow:
    '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  download: '<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  upload: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  sparkles:
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  github:
    '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  cube: '<path d="m21 16-9 5-9-5V8l9-5 9 5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  git: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  split:
    '<path d="M8 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3"/><path d="M16 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3" stroke-dasharray="2 2.5"/><path d="M12 3v18"/>',
  grid: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  play: '<path d="M6 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L7.5 3.64A1 1 0 0 0 6 4.5Z"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  "arrow-up-right": '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
} as const;

export type IconName = keyof typeof ICONS;

export interface DuotoneIconSpec {
  /** Soft translucent interior geometry (rendered with fill only). */
  fill?: string;
  /** Primary stroke paths (rendered in currentColor). */
  primary: string;
  /** Secondary contrasting accent stroke paths (rendered in `secondaryColor`). */
  secondary: string;
  /** Default complementary accent hue when `--ms-icon-secondary` is not set. */
  secondaryColor: string;
}

/**
 * True multi-color geometric split for icons rendered with `:duotone="true"`.
 * Each icon separates its silhouette (`primary`) from its inner core, active element,
 * or complementary structure (`secondary`) and an optional translucent volume (`fill`).
 */
export const ICON_DUOTONE: Partial<Record<IconName, DuotoneIconSpec>> = {
  plane: {
    fill: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l3 2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    primary:
      '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l3 2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    secondary: '<path d="M9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2"/>',
    secondaryColor: "#818cf8",
  },
  car: {
    fill: '<path d="M5 7h7l2.5 3H19a2 2 0 0 1 2 2v4H2v-4l1.6-3.2A2 2 0 0 1 5 7Z"/>',
    primary:
      '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><path d="M9 17h6"/>',
    secondary: '<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5.5 11.5h8"/>',
    secondaryColor: "#22d3ee",
  },
  train: {
    fill: '<path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/>',
    primary:
      '<path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
    secondary: '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/>',
    secondaryColor: "#38bdf8",
  },
  anchor: {
    fill: '<circle cx="12" cy="5" r="3"/>',
    primary: '<path d="M12 22V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>',
    secondary: '<circle cx="12" cy="5" r="3"/><path d="M9 11h6"/>',
    secondaryColor: "#60a5fa",
  },
  zap: {
    fill: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    primary:
      '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    secondary: '<path d="M3.5 8.5A9 9 0 0 1 8.5 3.5"/><path d="M20.5 15.5A9 9 0 0 1 15.5 20.5"/>',
    secondaryColor: "#22d3ee",
  },
  flame: {
    fill: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    primary:
      '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    secondary: '<path d="M12 21a3.2 3.2 0 0 0 3.2-3.2c0-1.5-.9-2.6-2.1-3.6-.5 1-1.4 1.6-2.2 1.6-.9 0-2.1 1.2-2.1 2a3.2 3.2 0 0 0 3.2 3.2z"/>',
    secondaryColor: "#facc15",
  },
  atom: {
    fill: '<circle cx="12" cy="12" r="4"/>',
    primary:
      '<path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/>',
    secondary:
      '<circle cx="12" cy="12" r="1.5"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/>',
    secondaryColor: "#22d3ee",
  },
  building: {
    fill: '<rect x="6" y="2" width="12" height="20" rx="2"/>',
    primary:
      '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>',
    secondary: '<path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
    secondaryColor: "#2dd4bf",
  },
  cpu: {
    fill: '<rect width="16" height="16" x="4" y="4" rx="2"/>',
    primary:
      '<rect width="16" height="16" x="4" y="4" rx="2"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
    secondary: '<rect width="6" height="6" x="9" y="9" rx="1"/>',
    secondaryColor: "#a78bfa",
  },
  bot: {
    fill: '<rect width="16" height="12" x="4" y="8" rx="2"/>',
    primary: '<rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/>',
    secondary: '<path d="M12 8V4H8"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    secondaryColor: "#22d3ee",
  },
  flask: {
    fill: '<path d="M7 16h10l2.6 4.55a1 1 0 0 1-.9 1.45H5.62a1 1 0 0 1-.9-1.45L7 16Z"/>',
    primary:
      '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/>',
    secondary: '<path d="M7 16h10"/><circle cx="10.5" cy="19" r="0.75"/><circle cx="14" cy="18.5" r="0.75"/>',
    secondaryColor: "#2dd4bf",
  },
  dna: {
    fill: '<circle cx="12" cy="12" r="5"/>',
    primary:
      '<path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993"/><path d="M2 15c6.667-6 13.333 0 20-6"/><path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993"/>',
    secondary:
      '<path d="m10 16 1.5 1.5"/><path d="m14 8-1.5-1.5"/><path d="m16.5 10.5 1 1"/><path d="m17 6-2.891-2.891"/><path d="m20 9 .891.891"/><path d="M3.109 14.109 4 15"/><path d="m6.5 12.5 1 1"/><path d="m7 18 2.891 2.891"/>',
    secondaryColor: "#818cf8",
  },
  layers: {
    fill: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>',
    primary:
      '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>',
    secondary:
      '<path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>',
    secondaryColor: "#818cf8",
  },
  box: {
    fill: '<path d="m12 3 8.7 5-8.7 5-8.7-5 8.7-5Z"/>',
    primary:
      '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
    secondary: '<path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    secondaryColor: "#818cf8",
  },
  cube: {
    fill: '<path d="m12 3 9 5-9 5-9-5 9-5z"/>',
    primary: '<path d="m21 16-9 5-9-5V8l9-5 9 5z"/>',
    secondary: '<path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
    secondaryColor: "#818cf8",
  },
  database: {
    fill: '<ellipse cx="12" cy="5" rx="9" ry="3"/>',
    primary: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/>',
    secondary: '<path d="M3 12A9 3 0 0 0 21 12"/>',
    secondaryColor: "#818cf8",
  },
  search: {
    fill: '<circle cx="11" cy="11" r="8"/>',
    primary: '<circle cx="11" cy="11" r="8"/>',
    secondary: '<path d="m21 21-4.3-4.3"/><path d="M8.5 8.5a3.5 3.5 0 0 1 5 0"/>',
    secondaryColor: "#818cf8",
  },
  shield: {
    fill: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    primary:
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    secondary: '<path d="m9 12 2 2 4-4"/>',
    secondaryColor: "#34d399",
  },
  activity: {
    fill: '<rect x="2" y="4" width="20" height="16" rx="3"/>',
    primary:
      '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    secondary: '<circle cx="9" cy="2.5" r="1.5"/><circle cx="15" cy="21.5" r="1.5"/>',
    secondaryColor: "#34d399",
  },
  workflow: {
    fill: '<rect width="8" height="8" x="3" y="3" rx="2"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    primary: '<rect width="8" height="8" x="3" y="3" rx="2"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    secondary: '<path d="M7 11v4a2 2 0 0 0 2 2h4"/>',
    secondaryColor: "#818cf8",
  },
  target: {
    fill: '<circle cx="12" cy="12" r="10"/>',
    primary: '<circle cx="12" cy="12" r="10"/>',
    secondary: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    secondaryColor: "#fbbf24",
  },
  download: {
    fill: '<rect x="3" y="14" width="18" height="7" rx="2"/>',
    primary: '<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/>',
    secondary: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
    secondaryColor: "#34d399",
  },
  upload: {
    fill: '<rect x="3" y="14" width="18" height="7" rx="2"/>',
    primary: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/>',
    secondary: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
    secondaryColor: "#818cf8",
  },
  code: {
    fill: '<rect x="3" y="5" width="18" height="14" rx="3"/>',
    primary: '<path d="m8 6-6 6 6 6"/>',
    secondary: '<path d="m16 18 6-6-6-6"/>',
    secondaryColor: "#818cf8",
  },
  terminal: {
    fill: '<rect x="2" y="4" width="20" height="16" rx="3"/>',
    primary: '<path d="m4 17 6-6-6-6"/>',
    secondary: '<path d="M12 19h8"/>',
    secondaryColor: "#34d399",
  },
  sparkles: {
    fill: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    primary:
      '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    secondary: '<path d="M19 3v4"/><path d="M21 5h-4"/><circle cx="5" cy="19" r="1.25"/>',
    secondaryColor: "#a78bfa",
  },
  globe: {
    fill: '<circle cx="12" cy="12" r="10"/>',
    primary: '<circle cx="12" cy="12" r="10"/>',
    secondary: '<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    secondaryColor: "#818cf8",
  },
  gauge: {
    fill: '<path d="M3.34 19a10 10 0 1 1 17.32 0Z"/>',
    primary: '<path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    secondary: '<path d="m12 14 4-4"/><circle cx="12" cy="14" r="1.5"/>',
    secondaryColor: "#34d399",
  },
  link: {
    fill: '<circle cx="12" cy="12" r="5"/>',
    primary: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>',
    secondary: '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    secondaryColor: "#818cf8",
  },
};
