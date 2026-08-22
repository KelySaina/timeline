/**
 * The story layouts the API will accept — how the timeline itself is drawn, not what colour it is.
 *
 * Same arrangement as themes.ts, and for the same reason: the web app keeps its own copy in
 * api/types.ts and a display registry in lib/storyLayouts.ts (separate package, no shared build),
 * and the tests walk this list. A layout that ships in the SPA but is missing here is rejected at
 * the edge with a 400 rather than half-working.
 *
 * This list must stay in step with the check constraint in migrations/002_story_layout.sql —
 * otherwise the database rejects what the validator accepted, and a 400 becomes a 500.
 */
export const STORY_LAYOUTS = [
  // The original: a straight rail with a node per memory.
  'rail',
  // A path that meanders, its curves tightening where memories cluster.
  'road',
  // A transit diagram; locations become stations and trips become spurs.
  'route',
  // No rail — a collage per year, block size following the weight of each memory.
  'album',
  // Horizontal bands: swipe sideways inside a year, scroll down between years.
  'reel',
  // One line deflecting on mood and type, so the whole story has a silhouette.
  'heartline',
] as const;

export type StoryLayout = (typeof STORY_LAYOUTS)[number];
