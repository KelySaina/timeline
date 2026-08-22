import type { TimelineEvent } from '@/api/types';
import { daysBetween } from '@/lib/format';

/**
 * How emphatic a memory is, on a 0.28–1 scale, for the layouts whose shape is data-driven.
 *
 * Kept out of the components because two of them need it and neither owns it, and because the
 * weighting is a product decision worth reading in one place rather than inferring from a template.
 */

/**
 * How far each mood leans the line out. Not a happiness scale — bittersweet leans as hard as
 * joyful, because the line draws what moved you, not what pleased you. An unlogged mood sits
 * mid-scale rather than flat, so a couple who never fills the field in still gets a shape.
 */
const MOOD_WEIGHT: Record<string, number> = {
  joyful: 1, excited: 0.95, tender: 0.9, proud: 0.85, bittersweet: 0.8,
  nostalgic: 0.65, silly: 0.6, peaceful: 0.4,
};

const TYPE_WEIGHT: Record<string, number> = {
  milestone: 1, life: 0.95, trip: 0.85, celebration: 0.8, birthday: 0.7,
  conversation: 0.55, gift: 0.5, memory: 0.5, custom: 0.45,
};

const clamp = (value: number) => Math.min(1, Math.max(0.28, value));

/** For the heartline: how much this memory moved you. */
export function feltWeight(event: TimelineEvent): number {
  const mood = event.mood ? (MOOD_WEIGHT[event.mood] ?? 0.6) : 0.5;
  const type = TYPE_WEIGHT[event.type] ?? 0.5;
  // Photos are a signal too — nobody attaches six pictures to a forgettable evening.
  const carried = Math.min(0.2, event.photos.length * 0.05);
  return clamp(mood * 0.55 + type * 0.45 + carried);
}

/** For the road: how far apart this memory and the next one are, as a bend. */
export function paceWeight(event: TimelineEvent, neighbour?: TimelineEvent): number {
  const gap = neighbour ? Math.abs(daysBetween(event.eventDate, neighbour.eventDate)) : 120;
  return clamp(gap / 240);
}
