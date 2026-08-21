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

export const THEME_NAMES = ['dawn', 'bloom', 'linen', 'dusk', 'ink', 'midnight'] as const;
export type Theme = (typeof THEME_NAMES)[number];

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

export type EventDraft = {
  type: EventType;
  title: string;
  eventDate: string;
  description?: string | null;
  endDate?: string | null;
  datePrecision?: DatePrecision;
  location?: string | null;
  mood?: Mood | null;
  tags?: string[];
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  birthday: string | null;
  hasAvatar: boolean;
};

export type Member = {
  id: string;
  displayName: string;
  birthday: string | null;
  hasAvatar: boolean;
  role: 'owner' | 'partner';
  joinedAt: string;
};

export type Elapsed = { years: number; months: number; days: number; totalDays: number };

export type Couple = {
  id: string;
  title: string | null;
  startedOn: string | null;
  theme: Theme;
  role: 'owner' | 'partner';
  members: Member[];
  together: Elapsed | null;
  stats: { memories: number; trips: number; milestones: number; photos: number; upcoming: number };
};

export type Invitation = { id: string; code: string; expiresAt: string; createdAt: string };

export type InvitePreview = {
  code: string;
  coupleTitle: string | null;
  invitedBy: string;
  startedOn: string | null;
};

export type UpcomingItem = {
  key: string;
  kind: 'anniversary' | 'birthday' | 'custom' | 'plan';
  title: string;
  date: string;
  daysUntil: number;
  ordinal: number | null;
  recurring: boolean;
  eventId: string | null;
  eventType: EventType | null;
  location: string | null;
  photoCount: number;
  remindDaysBefore: number | null;
};

export type RecurringDate = {
  id: string;
  kind: 'anniversary' | 'birthday' | 'custom';
  title: string;
  month: number;
  day: number;
  startYear: number | null;
  source: 'couple_anniversary' | 'member_birthday' | 'custom';
  editable: boolean;
  remindDaysBefore: number;
  nextDate: string;
};

export type Summary = {
  years: { year: number; count: number }[];
  types: Partial<Record<EventType, number>>;
  firstDate: string | null;
  lastDate: string | null;
  upcomingCount: number;
};
