import type { Theme } from '@/api/types';

export type ThemeMeta = {
  id: Theme;
  label: string;
  blurb: string;
  mood: 'daylight' | 'evening';
  /**
   * Swatch colours, mirrored from styles/main.css. Duplicated on purpose: the picker has to
   * paint all six themes at once, and only the active one exists as computed CSS variables.
   */
  swatch: { paper: string; surface: string; ember: string };
};

export const THEMES: ThemeMeta[] = [
  {
    id: 'dawn',
    label: 'Dawn',
    blurb: 'Warm paper and ember',
    mood: 'daylight',
    swatch: { paper: '#fbf7f3', surface: '#fffdfb', ember: '#c2544d' },
  },
  {
    id: 'bloom',
    label: 'Bloom',
    blurb: 'Blush and plum',
    mood: 'daylight',
    swatch: { paper: '#fdf6f7', surface: '#fffdfe', ember: '#b8557f' },
  },
  {
    id: 'linen',
    label: 'Linen',
    blurb: 'Sand, sage, terracotta',
    mood: 'daylight',
    swatch: { paper: '#f8f6f1', surface: '#fffefb', ember: '#b06a4f' },
  },
  {
    id: 'dusk',
    label: 'Dusk',
    blurb: 'Charcoal and coral',
    mood: 'evening',
    swatch: { paper: '#17130f', surface: '#221c18', ember: '#e8837a' },
  },
  {
    id: 'ink',
    label: 'Ink',
    blurb: 'Near-black and gold',
    mood: 'evening',
    swatch: { paper: '#131211', surface: '#1c1b19', ember: '#d9a74e' },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    blurb: 'Blue hour, periwinkle',
    mood: 'evening',
    swatch: { paper: '#12141c', surface: '#1a1d27', ember: '#a3b3f7' },
  },
];

export const THEME_IDS = THEMES.map((theme) => theme.id);

export const themeMeta = (id: Theme | undefined): ThemeMeta => THEMES.find((t) => t.id === id) ?? THEMES[0]!;
