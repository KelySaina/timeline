/**
 * The themes the API will accept. The web app has its own copy in
 * api/types.ts (separate package, no shared build) and a display registry in
 * lib/themes.ts; the tests walk this list, so a theme shipped in the CSS but
 * missing here is rejected at the edge with a 400 rather than half-working.
 */
export const THEMES = [
  'dawn', 'bloom', 'linen',
  'dusk', 'ink', 'midnight',
  'peony', 'garden', 'wildflower', 'sakura',
  'sepia', 'parchment', 'heirloom', 'postcard', 'velvet',
  'neon', 'vapor', 'arcade', 'tokyo',
  'blueprint', 'brass', 'mecha',
  'starlight', 'aurora', 'nebula',
  'tide', 'ember',
] as const;

export type ThemeName = (typeof THEMES)[number];
