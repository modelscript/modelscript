// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Minimal stroke icon set (24×24, Lucide-compatible geometry, ISC-licensed shapes)
 * paired with true two-tone duotone layer definitions (`ICON_DUOTONE`).
 * Rendered by `MsIcon.vue`. Kept as plain strings so the set is tree-shake friendly
 * and usable from both Vue components and Node-side config.
 */
export const ICONS = {
  plane:
    '<path d="M21 3 14.5 9.5 20 18l-2 1.5-6.5-6.5-4 4 .5 3.5L6.5 22l-2-3.5L1 16.5 2.5 15l3.5.5 4-4L3.5 5 5 3l8.5 5.5L20 2c.6-.4 1.4.4 1 1Z"/>',
  car: '<path d="M3 14.5V12a2 2 0 0 1 1.2-1.84L6 9.4l2.1-2.52A2 2 0 0 1 9.64 6h5.72a2 2 0 0 1 1.54.72L19 9.4l1.8.76A2 2 0 0 1 22 12v2.5a1.5 1.5 0 0 1-1.5 1.5H19"/><path d="M5 16H3.5A1.5 1.5 0 0 1 2 14.5"/><path d="M9 16h6"/><circle cx="7" cy="16" r="2"/><circle cx="17" cy="16" r="2"/>',
  train:
    '<path d="M9 3h6l-3 3-3-3Z"/><path d="M6 6h12a3 3 0 0 1 3 3v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a3 3 0 0 1 3-3Z"/><path d="M3 12h18"/><path d="M7.5 15.5h.01"/><path d="M16.5 15.5h.01"/><path d="m7 19-2 3"/><path d="m17 19 2 3"/><path d="M4 21h16"/>',
  anchor:
    '<circle cx="12" cy="4.5" r="2.5"/><path d="M12 7v14"/><path d="M8.5 10.5h7"/><path d="M5 14H3a9 9 0 0 0 18 0h-2"/><path d="m3 14 2.5-2"/><path d="m21 14-2.5-2"/>',
  zap: '<path d="M13 2 4.5 13.5h6L9.5 22 19.5 10.5h-6L13 2Z"/><path d="M2 7h3"/><path d="M19 7h3"/><path d="M2 17h3"/><path d="M19 17h3"/>',
  flame:
    '<path d="M12 2.5c1.5 3.2 4.5 5.3 6 8.2a6.8 6.8 0 0 1-12 6.3C4.8 14.5 5.4 11 7.5 8.8c.5 1.5 1.5 2.2 2.2 2.2-.4-2.8.4-5.8 2.3-8.5Z"/><path d="M12 20.5a3 3 0 0 0 3-3c0-1.6-1.2-2.8-3-4.3-1.8 1.5-3 2.7-3 4.3a3 3 0 0 0 3 3Z"/><path d="M4 21.5h16"/>',
  atom: '<circle cx="12" cy="12" r="1.75"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(30 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-30 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(90 12 12)"/>',
  building:
    '<path d="M6 21V4a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 4v17"/><path d="M2 21V11a1 1 0 0 1 1-1h3"/><path d="M22 21V9a1 1 0 0 0-1-1h-3"/><path d="M1.5 21h21"/><path d="M9.5 6.5h5"/><path d="M9.5 10h5"/><path d="M9.5 13.5h5"/><path d="M10 21v-4h4v4"/>',
  cpu: '<rect width="14" height="14" x="5" y="5" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M9 2v3"/><path d="M12 2v3"/><path d="M15 2v3"/><path d="M9 19v3"/><path d="M12 19v3"/><path d="M15 19v3"/><path d="M2 9h3"/><path d="M2 12h3"/><path d="M2 15h3"/><path d="M19 9h3"/><path d="M19 12h3"/><path d="M19 15h3"/>',
  bot: '<path d="M4 21h16"/><path d="M7 21v-3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/><circle cx="9" cy="13" r="2"/><circle cx="14" cy="6" r="2"/><path d="m10.4 11.4 2.4-3.8"/><path d="m15.9 6.6 3.1 1.9"/><path d="M19 8.5 21.5 7"/><path d="M19 8.5 20.5 11"/>',
  flask:
    '<path d="M9.5 2.5v6.2a2 2 0 0 1-.24.95L4.5 18.8A2 2 0 0 0 6.28 21.5h11.44a2 2 0 0 0 1.78-2.7l-4.76-9.15a2 2 0 0 1-.24-.95V2.5"/><path d="M8 2.5h8"/><path d="M6.3 15.5h11.4"/><circle cx="10" cy="18.2" r="0.8"/><circle cx="14" cy="17.8" r="0.9"/><circle cx="12.5" cy="12.5" r="0.7"/>',
  dna: '<path d="M6 3c0 4.5 12 4.5 12 9s-12 4.5-12 9"/><path d="M18 3c0 4.5-12 4.5-12 9s12 4.5 12 9"/><path d="M7.5 5.5h9"/><path d="M8.5 8.5h7"/><path d="M8.5 15.5h7"/><path d="M7.5 18.5h9"/>',
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
  vscode:
    '<path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/>',
  openvsx:
    '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5v-9zm-4.5 3c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5v-6zm9 1.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v4.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V12z"/>',
  npm:
    '<path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"/>',
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
    fill: '<path d="M21 3 14.5 9.5 20 18l-2 1.5-6.5-6.5-4 4L3.5 5 5 3l8.5 5.5L20 2c.6-.4 1.4.4 1 1Z"/>',
    primary: '<path d="M21 3 14.5 9.5 20 18l-2 1.5-6.5-6.5-4 4L3.5 5 5 3l8.5 5.5L20 2c.6-.4 1.4.4 1 1Z"/>',
    secondary: '<path d="M7.5 17l.5 3.5L6.5 22l-2-3.5L1 16.5 2.5 15l3.5.5"/><path d="M13.5 10.5 17 7"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  car: {
    fill: '<path d="M6 9.4 8.1 6.88A2 2 0 0 1 9.64 6h5.72a2 2 0 0 1 1.54.72L19 9.4l1.8.76A2 2 0 0 1 22 12v3.5H2V12c0-.8.5-1.5 1.2-1.84L6 9.4Z"/>',
    primary:
      '<path d="M3 14.5V12a2 2 0 0 1 1.2-1.84L6 9.4l2.1-2.52A2 2 0 0 1 9.64 6h5.72a2 2 0 0 1 1.54.72L19 9.4l1.8.76A2 2 0 0 1 22 12v2.5a1.5 1.5 0 0 1-1.5 1.5H19"/><path d="M5 16H3.5A1.5 1.5 0 0 1 2 14.5"/><path d="M9 16h6"/>',
    secondary: '<circle cx="7" cy="16" r="2.2"/><circle cx="17" cy="16" r="2.2"/><path d="M6.5 10h11"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  train: {
    fill: '<rect x="4" y="6" width="16" height="13" rx="3.5"/>',
    primary: '<path d="M6 6h12a3 3 0 0 1 3 3v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a3 3 0 0 1 3-3Z"/><path d="M3 12h18"/>',
    secondary:
      '<path d="M9 3h6l-3 3-3-3Z"/><circle cx="8" cy="15.5" r="1"/><circle cx="16" cy="15.5" r="1"/><path d="m7 19-2 3"/><path d="m17 19 2 3"/><path d="M4 21h16"/>',
    secondaryColor: "var(--hue-amber, #d97706)",
  },
  anchor: {
    fill: '<circle cx="12" cy="4.5" r="2.5"/><path d="M5 14a7 7 0 0 0 14 0Z"/>',
    primary:
      '<path d="M12 7v14"/><path d="M5 14H3a9 9 0 0 0 18 0h-2"/><path d="m3 14 2.5-2"/><path d="m21 14-2.5-2"/>',
    secondary: '<circle cx="12" cy="4.5" r="2.5"/><path d="M8.5 10.5h7"/>',
    secondaryColor: "var(--hue-cyan, #0891b2)",
  },
  zap: {
    fill: '<path d="M13 2 4.5 13.5h6L9.5 22 19.5 10.5h-6L13 2Z"/>',
    primary: '<path d="M13 2 4.5 13.5h6L9.5 22 19.5 10.5h-6L13 2Z"/>',
    secondary:
      '<path d="M2 7h3.5"/><circle cx="2" cy="7" r="1"/><path d="M18.5 7H22"/><circle cx="22" cy="7" r="1"/><path d="M2 17h3.5"/><circle cx="2" cy="17" r="1"/><path d="M18.5 17H22"/><circle cx="22" cy="17" r="1"/>',
    secondaryColor: "var(--hue-amber, #d97706)",
  },
  flame: {
    fill: '<path d="M12 2.5c1.5 3.2 4.5 5.3 6 8.2a6.8 6.8 0 0 1-12 6.3C4.8 14.5 5.4 11 7.5 8.8c.5 1.5 1.5 2.2 2.2 2.2-.4-2.8.4-5.8 2.3-8.5Z"/>',
    primary:
      '<path d="M12 2.5c1.5 3.2 4.5 5.3 6 8.2a6.8 6.8 0 0 1-12 6.3C4.8 14.5 5.4 11 7.5 8.8c.5 1.5 1.5 2.2 2.2 2.2-.4-2.8.4-5.8 2.3-8.5Z"/>',
    secondary:
      '<path d="M12 19.5a2.8 2.8 0 0 0 2.8-2.8c0-1.5-1.1-2.6-2.8-4-1.7 1.4-2.8 2.5-2.8 4A2.8 2.8 0 0 0 12 19.5Z"/><path d="M5 21.5h14"/>',
    secondaryColor: "var(--hue-amber, #d97706)",
  },
  atom: {
    fill: '<circle cx="12" cy="12" r="4.5"/>',
    primary:
      '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"/>',
    secondary:
      '<circle cx="12" cy="12" r="1.8"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(90 12 12)"/>',
    secondaryColor: "var(--hue-teal, #0d9488)",
  },
  building: {
    fill: '<rect x="6" y="2.5" width="12" height="18.5" rx="1.5"/>',
    primary:
      '<path d="M6 21V4a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 4v17"/><path d="M2 21V11a1 1 0 0 1 1-1h3"/><path d="M22 21V9a1 1 0 0 0-1-1h-3"/><path d="M1.5 21h21"/>',
    secondary:
      '<path d="M9.5 6.5h5"/><path d="M9.5 10h5"/><path d="M9.5 13.5h5"/><path d="M10 21v-4h4v4"/>',
    secondaryColor: "var(--hue-cyan, #0891b2)",
  },
  cpu: {
    fill: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
    primary:
      '<rect width="14" height="14" x="5" y="5" rx="2"/><path d="M9 2v3"/><path d="M12 2v3"/><path d="M15 2v3"/><path d="M9 19v3"/><path d="M12 19v3"/><path d="M15 19v3"/><path d="M2 9h3"/><path d="M2 12h3"/><path d="M2 15h3"/><path d="M19 9h3"/><path d="M19 12h3"/><path d="M19 15h3"/>',
    secondary: '<rect width="6" height="6" x="9" y="9" rx="1"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  bot: {
    fill: '<path d="M7 21v-3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3Z"/><circle cx="9" cy="13" r="2"/><circle cx="14" cy="6" r="2"/>',
    primary:
      '<path d="M4 21h16"/><path d="M7 21v-3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/><path d="m10.4 11.4 2.4-3.8"/><path d="m15.9 6.6 3.1 1.9"/>',
    secondary:
      '<circle cx="9" cy="13" r="2"/><circle cx="14" cy="6" r="2"/><path d="M19 8.5 21.5 7"/><path d="M19 8.5 20.5 11"/>',
    secondaryColor: "var(--hue-rose, #e11d48)",
  },
  flask: {
    fill: '<path d="M6.3 15.5h11.4l1.8 3.3A2 2 0 0 1 17.72 21.5H6.28A2 2 0 0 1 4.5 18.8l1.8-3.3Z"/>',
    primary:
      '<path d="M9.5 2.5v6.2a2 2 0 0 1-.24.95L4.5 18.8A2 2 0 0 0 6.28 21.5h11.44a2 2 0 0 0 1.78-2.7l-4.76-9.15a2 2 0 0 1-.24-.95V2.5"/><path d="M8 2.5h8"/>',
    secondary:
      '<path d="M6.3 15.5h11.4"/><circle cx="10" cy="18.2" r="0.85"/><circle cx="14" cy="17.8" r="0.85"/><circle cx="12.5" cy="12.5" r="0.75"/>',
    secondaryColor: "var(--hue-violet, #7c3aed)",
  },
  dna: {
    fill: '<ellipse cx="12" cy="7.5" rx="5.5" ry="4"/><ellipse cx="12" cy="16.5" rx="5.5" ry="4"/>',
    primary: '<path d="M6 3c0 4.5 12 4.5 12 9s-12 4.5-12 9"/><path d="M18 3c0 4.5-12 4.5-12 9s12 4.5 12 9"/>',
    secondary: '<path d="M7.5 5.5h9"/><path d="M8.5 8.5h7"/><path d="M8.5 15.5h7"/><path d="M7.5 18.5h9"/>',
    secondaryColor: "var(--hue-teal, #0d9488)",
  },
  layers: {
    fill: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>',
    primary:
      '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>',
    secondary:
      '<path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  box: {
    fill: '<path d="m12 3 8.7 5-8.7 5-8.7-5 8.7-5Z"/>',
    primary:
      '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
    secondary: '<path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  cube: {
    fill: '<path d="m12 3 9 5-9 5-9-5 9-5z"/>',
    primary: '<path d="m21 16-9 5-9-5V8l9-5 9 5z"/>',
    secondary: '<path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  database: {
    fill: '<ellipse cx="12" cy="5" rx="9" ry="3"/>',
    primary: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/>',
    secondary: '<path d="M3 12A9 3 0 0 0 21 12"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  search: {
    fill: '<circle cx="11" cy="11" r="8"/>',
    primary: '<circle cx="11" cy="11" r="8"/>',
    secondary: '<path d="m21 21-4.3-4.3"/><path d="M8.5 8.5a3.5 3.5 0 0 1 5 0"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  shield: {
    fill: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    primary:
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    secondary: '<path d="m9 12 2 2 4-4"/>',
    secondaryColor: "var(--hue-emerald, #059669)",
  },
  activity: {
    fill: '<rect x="2" y="4" width="20" height="16" rx="3"/>',
    primary:
      '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    secondary: '<circle cx="9" cy="2.5" r="1.5"/><circle cx="15" cy="21.5" r="1.5"/>',
    secondaryColor: "var(--hue-emerald, #059669)",
  },
  workflow: {
    fill: '<rect width="8" height="8" x="3" y="3" rx="2"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    primary: '<rect width="8" height="8" x="3" y="3" rx="2"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    secondary: '<path d="M7 11v4a2 2 0 0 0 2 2h4"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  target: {
    fill: '<circle cx="12" cy="12" r="10"/>',
    primary: '<circle cx="12" cy="12" r="10"/>',
    secondary: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    secondaryColor: "var(--hue-amber, #d97706)",
  },
  download: {
    fill: '<rect x="3" y="14" width="18" height="7" rx="2"/>',
    primary: '<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/>',
    secondary: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
    secondaryColor: "var(--hue-emerald, #059669)",
  },
  upload: {
    fill: '<rect x="3" y="14" width="18" height="7" rx="2"/>',
    primary: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/>',
    secondary: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  code: {
    fill: '<rect x="3" y="5" width="18" height="14" rx="3"/>',
    primary: '<path d="m8 6-6 6 6 6"/>',
    secondary: '<path d="m16 18 6-6-6-6"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  terminal: {
    fill: '<rect x="2" y="4" width="20" height="16" rx="3"/>',
    primary: '<path d="m4 17 6-6-6-6"/>',
    secondary: '<path d="M12 19h8"/>',
    secondaryColor: "var(--hue-emerald, #059669)",
  },
  sparkles: {
    fill: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    primary:
      '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    secondary: '<path d="M19 3v4"/><path d="M21 5h-4"/><circle cx="5" cy="19" r="1.25"/>',
    secondaryColor: "var(--hue-violet, #7c3aed)",
  },
  globe: {
    fill: '<circle cx="12" cy="12" r="10"/>',
    primary: '<circle cx="12" cy="12" r="10"/>',
    secondary: '<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  gauge: {
    fill: '<path d="M3.34 19a10 10 0 1 1 17.32 0Z"/>',
    primary: '<path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    secondary: '<path d="m12 14 4-4"/><circle cx="12" cy="14" r="1.5"/>',
    secondaryColor: "var(--hue-emerald, #059669)",
  },
  link: {
    fill: '<circle cx="12" cy="12" r="5"/>',
    primary: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>',
    secondary: '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    secondaryColor: "var(--hue-indigo, #4f46e5)",
  },
  vscode: {
    primary:
      '<path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352z"/>',
    secondary: '<path d="M18.004 17.448L10.826 12l7.178-5.448v10.896z"/>',
    secondaryColor: "var(--hue-cyan, #0891b2)",
  },
  openvsx: {
    primary: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>',
    secondary: '<path d="M10.5 7.5v9M6 10.5v6M15 12v4.5"/>',
    secondaryColor: "var(--hue-amber, #d97706)",
  },
};
