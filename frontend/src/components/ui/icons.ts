/**
 * Inline SVG icon set (24x24, stroke based) - avoids an icon font dependency.
 * Values are static markup owned by this file; never put user input in here.
 */

export const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17 17h.01M20 17v3h-3"/>',
  key: '<circle cx="7.5" cy="15.5" r="4"/><path d="M10.5 12.5 21 2m-4 1 3 3m-6 0 3 3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.6 5.34"/><path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07l1.5-1.5"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>',
  binary: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M17 3h2v7M14 10h7M3 14h4v7M3 21h7"/>',
  regex: '<path d="M12 4v8m-3.5-6 7 4m0-4-7 4"/><circle cx="6" cy="18" r="2"/><path d="M20 14v6"/>',
  fingerprint: '<path d="M12 3a8 8 0 0 0-8 8v2"/><path d="M20 13v-2a8 8 0 0 0-4-6.93"/><path d="M8 11a4 4 0 0 1 8 0v3a9 9 0 0 1-1 4"/><path d="M12 11v4a13 13 0 0 1-1.5 6"/><path d="M4 17a18 18 0 0 0 1 4"/><path d="M19 17a16 16 0 0 1-1.5 4.5"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="m4 12 6 6L20 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  play: '<path d="M6 3.5 20 12 6 20.5z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  terminal: '<path d="m4 17 6-5-6-5M12 19h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.01"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  wand: '<path d="m4 20 11-11M14 4l1.5 2.5L18 8l-2.5 1.5L14 12l-1.5-2.5L10 8l2.5-1.5zM19 14l.9 1.6L21.5 17l-1.6.9L19 19.5l-.9-1.6L16.5 17l1.6-.9z"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
  certificate:
    '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 8.5h10M7 12h5"/><circle cx="16.5" cy="16.5" r="3"/><path d="m14.8 18.8-.3 3.2 2-1.1 2 1.1-.3-3.2"/>',
  hex: '<path d="M4 4h16v16H4z"/><path d="M4 9h16M4 15h16M9.5 4v16"/><path d="M6 12h1.5M12 7h1.5M16 12h1.5M12 17h1.5"/>',
  network:
    '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7 7.5 10.3 16M17 7.5 13.7 16M7.5 6h9"/>',
} as const

export type IconName = keyof typeof ICONS
