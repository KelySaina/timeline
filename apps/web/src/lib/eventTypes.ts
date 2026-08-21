import type { EventType, Mood } from '@/api/types';

export type EventTypeMeta = {
  type: EventType;
  label: string;
  /** Font Awesome icon name, registered in lib/icons.ts */
  icon: string;
  emoji: string;
  color: string;
  /** Placeholder shown in the add sheet — a nudge, never a rule. */
  hint: string;
};

export const EVENT_TYPE_META: Record<EventType, EventTypeMeta> = {
  milestone: { type: 'milestone', label: 'Milestone', icon: 'heart', emoji: '❤️', color: 'var(--type-milestone)', hint: 'The day we became official' },
  memory:    { type: 'memory',    label: 'Memory',    icon: 'camera', emoji: '📸', color: 'var(--type-memory)', hint: 'That Sunday with no plans' },
  trip:      { type: 'trip',      label: 'Trip',      icon: 'plane', emoji: '✈️', color: 'var(--type-trip)', hint: 'Our week in Nosy Be' },
  birthday:  { type: 'birthday',  label: 'Birthday',  icon: 'cake-candles', emoji: '🎂', color: 'var(--type-birthday)', hint: 'Your birthday dinner' },
  gift:      { type: 'gift',      label: 'Gift',      icon: 'gift', emoji: '🎁', color: 'var(--type-gift)', hint: 'The ugly mug' },
  celebration: { type: 'celebration', label: 'Celebration', icon: 'champagne-glasses', emoji: '🥂', color: 'var(--type-celebration)', hint: 'New Year on the roof' },
  conversation: { type: 'conversation', label: 'Conversation', icon: 'comment-dots', emoji: '💬', color: 'var(--type-conversation)', hint: 'The 3am talk about the future' },
  life:      { type: 'life',      label: 'Life',      icon: 'house-chimney', emoji: '🏠', color: 'var(--type-life)', hint: 'Moved in together' },
  custom:    { type: 'custom',    label: 'Something else', icon: 'star', emoji: '⭐', color: 'var(--type-custom)', hint: 'Anything worth keeping' },
};

export const eventTypeList = Object.values(EVENT_TYPE_META);

export const typeMeta = (type: EventType): EventTypeMeta => EVENT_TYPE_META[type] ?? EVENT_TYPE_META.custom;

export const MOOD_META: Record<Mood, { label: string; emoji: string }> = {
  joyful: { label: 'Joyful', emoji: '😄' },
  tender: { label: 'Tender', emoji: '🥰' },
  excited: { label: 'Excited', emoji: '🤩' },
  proud: { label: 'Proud', emoji: '🥲' },
  nostalgic: { label: 'Nostalgic', emoji: '🌙' },
  peaceful: { label: 'Peaceful', emoji: '🍃' },
  bittersweet: { label: 'Bittersweet', emoji: '🌧️' },
  silly: { label: 'Silly', emoji: '😜' },
};

export const moodList = Object.entries(MOOD_META).map(([mood, meta]) => ({ mood: mood as Mood, ...meta }));

/** The five openers offered to a couple with an empty timeline. */
export const QUICK_STARTS: { title: string; type: EventType; prompt: string }[] = [
  { title: 'How we met', type: 'milestone', prompt: 'Where were you, and who spoke first?' },
  { title: 'Our first date', type: 'milestone', prompt: 'What did you do, and how long did it last?' },
  { title: 'When we became official', type: 'milestone', prompt: 'Who asked, and what exactly was said?' },
  { title: 'Our first trip', type: 'trip', prompt: 'Where did you go, and what went wrong?' },
  { title: 'Add something else', type: 'memory', prompt: 'Anything you want to keep.' },
];
