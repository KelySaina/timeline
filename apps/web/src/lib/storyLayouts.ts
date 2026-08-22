import { STORY_LAYOUTS, type StoryLayout } from '@/api/types';

export type StoryLayoutMeta = {
  id: StoryLayout;
  label: string;
  /** One line, shown under the name in the picker. */
  blurb: string;
  /**
   * What the shape is derived from. Worth naming in the UI: two of these only come alive once the
   * couple has been filling in optional fields, and it is fairer to say so than to let someone
   * pick a layout that draws them a straight line.
   */
  driver: string;
  /** Set when the layout needs data most couples leave empty at first. */
  needs?: string;
  icon: string;
};

export const STORY_LAYOUT_META: StoryLayoutMeta[] = [
  {
    id: 'rail',
    label: 'The Rail',
    blurb: 'A straight thread, every memory the same size',
    driver: 'Nothing but the order',
    icon: 'sliders',
  },
  {
    id: 'road',
    label: 'The Winding Road',
    blurb: 'A path that bends — tight where life was busy',
    driver: 'The gap between one memory and the next',
    icon: 'plane',
  },
  {
    id: 'route',
    label: 'The Route Map',
    blurb: 'A transit line where every place is a station',
    driver: 'The place each memory happened',
    needs: 'Best once memories carry a location',
    icon: 'location-dot',
  },
  {
    id: 'album',
    label: 'The Album',
    blurb: 'A scrapbook page a year, uneven on purpose',
    driver: 'Photos, and how much was written',
    icon: 'images',
  },
  {
    id: 'reel',
    label: 'The Reel',
    blurb: 'Swipe sideways through a year, scroll between them',
    driver: 'Nothing new — the years regrouped sideways',
    icon: 'camera',
  },
  {
    id: 'heartline',
    label: 'The Heartline',
    blurb: 'One line that leans out at the moments that moved you',
    driver: 'The mood and kind of each memory',
    needs: 'Best once memories carry a mood',
    icon: 'heart',
  },
];

const byId = new Map(STORY_LAYOUT_META.map((meta) => [meta.id, meta]));

/** Never throws: an unknown value from an older or newer build falls back to the original rail. */
export const storyLayoutMeta = (id?: string | null): StoryLayoutMeta =>
  byId.get(id as StoryLayout) ?? byId.get('rail')!;

export const isStoryLayout = (value: unknown): value is StoryLayout =>
  typeof value === 'string' && (STORY_LAYOUTS as readonly string[]).includes(value);
