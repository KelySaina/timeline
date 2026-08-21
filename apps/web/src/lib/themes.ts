import { THEME_NAMES, type Theme } from '@/api/types';

export type CollectionId =
  | 'daylight'
  | 'evening'
  | 'flowery'
  | 'antique'
  | 'neon'
  | 'mechanical'
  | 'cosmic'
  | 'elemental';

export type ThemeMeta = {
  id: Theme;
  label: string;
  /** One line, shown under the name in the store. */
  blurb: string;
  collection: CollectionId;
  tone: 'light' | 'dark';
  /**
   * What actually moves, in two or three words. Worth naming: it is the only way
   * to know a theme animates before applying it, and some of them deliberately
   * don't (blueprint, parchment).
   */
  cinematic?: string;
};

export const COLLECTIONS: { id: CollectionId; label: string; tagline: string }[] = [
  { id: 'daylight', label: 'Daylight', tagline: 'Paper in the morning' },
  { id: 'evening', label: 'Evening', tagline: 'Reading it on the sofa' },
  { id: 'flowery', label: 'Flowery', tagline: 'The album pressed with flowers' },
  { id: 'antique', label: 'Antique', tagline: 'Kept somewhere, for years' },
  { id: 'neon', label: 'Neon', tagline: 'After dark, lit by signs' },
  { id: 'mechanical', label: 'Mechanical', tagline: 'Drawn, machined, assembled' },
  { id: 'cosmic', label: 'Cosmic', tagline: 'The two of you, under a lot of sky' },
  { id: 'elemental', label: 'Elemental', tagline: 'Water and fire' },
];

/**
 * The registry the theme store browses. Colours are NOT duplicated here: every
 * preview tile carries the theme's own class, so it renders from the same CSS
 * variables the app uses and can never drift from it.
 */
export const THEMES: ThemeMeta[] = [
  // Daylight
  { id: 'dawn', label: 'Dawn', blurb: 'Warm paper and ember', collection: 'daylight', tone: 'light', cinematic: 'Paper grain' },
  { id: 'bloom', label: 'Bloom', blurb: 'Blush, plum, small hearts', collection: 'daylight', tone: 'light', cinematic: 'Hearts adrift' },
  { id: 'linen', label: 'Linen', blurb: 'Sand, sage, woven texture', collection: 'daylight', tone: 'light' },
  // Evening
  { id: 'dusk', label: 'Dusk', blurb: 'Charcoal and coral lamplight', collection: 'evening', tone: 'dark', cinematic: 'Lamplight breathes' },
  { id: 'ink', label: 'Ink', blurb: 'Near-black and printed gold', collection: 'evening', tone: 'dark', cinematic: 'Engraved hatch' },
  { id: 'midnight', label: 'Midnight', blurb: 'Blue hour, periwinkle, stars', collection: 'evening', tone: 'dark', cinematic: 'Stars twinkle' },
  // Flowery
  { id: 'peony', label: 'Peony', blurb: 'Blush paper, deep pink', collection: 'flowery', tone: 'light', cinematic: 'Petals fall' },
  { id: 'garden', label: 'Garden', blurb: 'Sage and cream, leaf green', collection: 'flowery', tone: 'light', cinematic: 'Sprigs sway' },
  { id: 'wildflower', label: 'Wildflower', blurb: 'Cream meadow, lupine violet', collection: 'flowery', tone: 'light', cinematic: 'Blooms drift' },
  { id: 'sakura', label: 'Sakura', blurb: 'Blossom at night', collection: 'flowery', tone: 'dark', cinematic: 'Petals fall' },
  // Antique
  { id: 'sepia', label: 'Sepia', blurb: 'A photograph left in the sun', collection: 'antique', tone: 'light', cinematic: 'Halftone and vignette' },
  { id: 'parchment', label: 'Parchment', blurb: 'Ivory and iron-gall ink', collection: 'antique', tone: 'light' },
  { id: 'heirloom', label: 'Heirloom', blurb: 'Deep green and gold filigree', collection: 'antique', tone: 'dark', cinematic: 'Filigree drifts' },
  { id: 'postcard', label: 'Postcard', blurb: 'Airmail edges, franked red', collection: 'antique', tone: 'light', cinematic: 'Stripes travel' },
  { id: 'velvet', label: 'Velvet', blurb: 'Wine, gold, a damask lattice', collection: 'antique', tone: 'dark', cinematic: 'Wine glow' },
  // Neon
  { id: 'neon', label: 'Neon', blurb: 'Magenta and cyan on black', collection: 'neon', tone: 'dark', cinematic: 'The sign flickers' },
  { id: 'vapor', label: 'Vapor', blurb: 'Pink, teal, a grid to the horizon', collection: 'neon', tone: 'dark', cinematic: 'Grid scrolls' },
  { id: 'arcade', label: 'Arcade', blurb: 'Lime on graphite', collection: 'neon', tone: 'dark', cinematic: 'CRT sweep' },
  { id: 'tokyo', label: 'Tokyo', blurb: 'Red and cyan in the rain', collection: 'neon', tone: 'dark', cinematic: 'Rain falls' },
  // Mechanical
  { id: 'blueprint', label: 'Blueprint', blurb: 'Cyanotype grid and ticks', collection: 'mechanical', tone: 'dark' },
  { id: 'brass', label: 'Brass', blurb: 'Copper, amber, machinery', collection: 'mechanical', tone: 'dark', cinematic: 'Gears creep' },
  { id: 'mecha', label: 'Mecha', blurb: 'Gunmetal and hazard orange', collection: 'mechanical', tone: 'dark', cinematic: 'Sensor sweep' },
  // Cosmic
  { id: 'starlight', label: 'Starlight', blurb: 'A clear night', collection: 'cosmic', tone: 'dark', cinematic: 'Stars twinkle' },
  { id: 'aurora', label: 'Aurora', blurb: 'Ribbons over the north', collection: 'cosmic', tone: 'dark', cinematic: 'Ribbons shift' },
  { id: 'nebula', label: 'Nebula', blurb: 'Violet dust', collection: 'cosmic', tone: 'dark', cinematic: 'Clouds turn over' },
  // Elemental
  { id: 'tide', label: 'Tide', blurb: 'Sea glass and coral', collection: 'elemental', tone: 'light', cinematic: 'Waves drift' },
  { id: 'ember', label: 'Ember', blurb: 'A fire burned down', collection: 'elemental', tone: 'dark', cinematic: 'Sparks rise' },
];

export const THEME_IDS = THEMES.map((theme) => theme.id);

export const themeMeta = (id: Theme | undefined): ThemeMeta => THEMES.find((t) => t.id === id) ?? THEMES[0]!;

export const themeClass = (id: Theme): string => `theme-${id}`;

export const collectionOf = (id: CollectionId) => COLLECTIONS.find((c) => c.id === id);

export const themesIn = (collection: CollectionId): ThemeMeta[] =>
  THEMES.filter((theme) => theme.collection === collection);

/**
 * Guards the registry against the type list drifting out of sync — a theme in
 * THEME_NAMES with no entry here would simply never appear in the store.
 */
export const missingFromRegistry = (): string[] =>
  THEME_NAMES.filter((name) => !THEMES.some((theme) => theme.id === name));
