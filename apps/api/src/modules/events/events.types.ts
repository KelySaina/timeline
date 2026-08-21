export const EVENT_TYPES = [
  'milestone',
  'memory',
  'trip',
  'birthday',
  'gift',
  'celebration',
  'conversation',
  'life',
  'custom',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const MOODS = [
  'joyful',
  'tender',
  'excited',
  'proud',
  'nostalgic',
  'peaceful',
  'bittersweet',
  'silly',
] as const;

export type Mood = (typeof MOODS)[number];
export type DatePrecision = 'day' | 'month' | 'year';

export type EventPhoto = { id: string; width: number; height: number; position: number };

export type TimelineEvent = {
  id: string;
  type: EventType;
  title: string;
  description: string | null;
  eventDate: string;
  endDate: string | null;
  datePrecision: DatePrecision;
  location: string | null;
  mood: Mood | null;
  tags: string[];
  photos: EventPhoto[];
  author: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
};
