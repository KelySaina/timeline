/**
 * Demo story so the timeline can be judged the way a couple would see it: a few years of memories,
 * photos, tags and future plans. Safe to re-run — it rebuilds the two demo accounts from scratch.
 */
import sharp from 'sharp';
import { pool, query, queryOne } from './pool.js';
import { migrate } from './migrate.js';
import { hashPassword } from '../lib/password.js';
import { removeObject } from '../modules/photos/storage/index.js';
import { createCouple } from '../modules/couples/couples.service.js';
import { addPhotos, createEvent } from '../modules/events/events.service.js';
import { acceptInvitation, createInvitation } from '../modules/couples/couples.service.js';

const PASSWORD = 'loveletters2024';

const palettes = [
  ['#f5c8b8', '#c98a7a', '#7d4a52'],
  ['#f7dcae', '#e0a06c', '#8a5a3b'],
  ['#cfe0d8', '#8fb8a8', '#3f6b5e'],
  ['#e6d7f2', '#b79ad4', '#6a4d8c'],
  ['#ffd9d0', '#f2a08c', '#b05a55'],
];

async function fakePhoto(seed: number): Promise<Express.Multer.File> {
  const palette = palettes[seed % palettes.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${palette[0]}"/>
        <stop offset="55%" stop-color="${palette[1]}"/>
        <stop offset="100%" stop-color="${palette[2]}"/>
      </linearGradient>
    </defs>
    <rect width="1400" height="1000" fill="url(#g)"/>
    <circle cx="${300 + seed * 90}" cy="${260 + seed * 40}" r="${140 + seed * 12}" fill="#ffffff" opacity="0.16"/>
    <circle cx="${1050 - seed * 60}" cy="${700 - seed * 30}" r="${190 - seed * 8}" fill="#000000" opacity="0.10"/>
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
  return { buffer, size: buffer.byteLength, mimetype: 'image/jpeg', originalname: `memory-${seed}.jpg` } as Express.Multer.File;
}

type SeedEvent = {
  type: Parameters<typeof createEvent>[2]['type'];
  title: string;
  eventDate: string;
  endDate?: string;
  description?: string;
  location?: string;
  mood?: Parameters<typeof createEvent>[2]['mood'];
  tags?: string[];
  photos?: number;
  by?: 'a' | 'b';
};

const story: SeedEvent[] = [
  {
    type: 'milestone', title: 'The day we met', eventDate: '2024-03-12',
    description: "A friend's birthday party neither of us wanted to go to. We talked until the music stopped and I didn't know this person would become my favourite human.",
    location: 'Antananarivo', mood: 'nostalgic', tags: ['how we met', 'party'], photos: 1,
  },
  { type: 'memory', title: 'First message at 2am', eventDate: '2024-03-13', description: '"So… coffee? I promise I am more coherent before midnight."', mood: 'silly', tags: ['inside joke'], by: 'b' },
  { type: 'milestone', title: 'First date', eventDate: '2024-04-03', description: 'Coffee that turned into lunch that turned into a walk that turned into dinner. Nine hours.', location: 'Café de la Gare', mood: 'excited', tags: ['first date'], photos: 2 },
  { type: 'milestone', title: 'First kiss', eventDate: '2024-04-17', description: 'In the rain, outside your building, both of us pretending we were not nervous.', mood: 'tender', tags: ['first kiss'], by: 'b' },
  { type: 'milestone', title: 'Officially us', eventDate: '2024-06-01', description: 'No grand speech. Just "so, we are doing this?" — "yes, obviously."', mood: 'joyful', tags: ['official'], photos: 1 },
  { type: 'trip', title: 'First trip together', eventDate: '2024-12-21', endDate: '2024-12-28', description: 'Seven days, one backpack too few, zero regrets. You got sunburnt on day two and blamed me.', location: 'Nosy Be', mood: 'joyful', tags: ['travel', 'beach'], photos: 3, by: 'b' },
  { type: 'celebration', title: 'Valentine’s Day', eventDate: '2025-02-14', description: 'We cooked badly and laughed a lot. Best meal of the year.', mood: 'tender', tags: ['valentine'], photos: 1 },
  { type: 'life', title: 'Moved in together', eventDate: '2025-09-08', description: 'Two flats, one van, forty-one boxes, and one very confused cat.', location: 'Ivandry', mood: 'proud', tags: ['home'], photos: 2 },
  { type: 'gift', title: 'The ugly mug', eventDate: '2025-10-04', description: 'You said it was hideous. You have used it every morning since.', mood: 'silly', tags: ['inside joke', 'gift'], by: 'b' },
  { type: 'conversation', title: 'The 3am talk about the future', eventDate: '2025-11-19', description: 'Kids, cities, whose turn it is to do the dishes forever. We agreed on almost everything.', mood: 'peaceful', tags: ['future'] },
  { type: 'trip', title: 'Our Madagascar road trip', eventDate: '2026-07-02', endDate: '2026-07-16', description: 'RN7 end to end. Baobabs, one flat tyre, the best zebu skewers of our lives.', location: 'RN7', mood: 'joyful', tags: ['travel', 'road trip'], photos: 3, by: 'b' },
  { type: 'memory', title: 'Sunday of doing absolutely nothing', eventDate: '2026-08-09', description: 'Rain, coffee, three films, no plans. Perfect.', mood: 'peaceful', tags: ['home'] },
  { type: 'celebration', title: 'Anniversary dinner', eventDate: '2026-09-12', description: 'The place with the terrace we walked past on our first date. Booked at last.', location: 'La Terrasse', tags: ['anniversary'] },
  { type: 'trip', title: 'Paris, finally', eventDate: '2027-06-04', endDate: '2027-06-12', description: 'The trip we have been talking about since the 3am conversation.', location: 'Paris', tags: ['travel', 'future'] },
];

/**
 * Re-runnable: drop the demo couple first (events, photos and members cascade with it), then the
 * accounts. couples.created_by is ON DELETE RESTRICT, so the order matters — and the stored files
 * are removed before the rows that point at them, or they would leak on every reseed.
 */
async function resetDemo(): Promise<void> {
  const users = await query<{ id: string; avatar_key: string | null }>(
    "select id, avatar_key from users where email in ('alex@timeline.love', 'mira@timeline.love')",
  );
  if (users.length === 0) return;
  const ids = users.map((user) => user.id);

  const photos = await query<{ storage_key: string; thumb_key: string }>(
    `select storage_key, thumb_key from event_photos
      where couple_id in (select id from couples where created_by = any($1::uuid[]))`,
    [ids],
  );
  await Promise.all([
    ...photos.flatMap((photo) => [removeObject(photo.storage_key), removeObject(photo.thumb_key)]),
    ...users.filter((user) => user.avatar_key).map((user) => removeObject(user.avatar_key!)),
  ]);

  await query('delete from couples where created_by = any($1::uuid[])', [ids]);
  await query('delete from users where id = any($1::uuid[])', [ids]);
}

async function makeUser(email: string, name: string, birthday: string): Promise<string> {
  const rows = await query<{ id: string }>(
    `insert into users (email, password_hash, display_name, birthday)
     values ($1, $2, $3, $4) returning id`,
    [email, await hashPassword(PASSWORD), name, birthday],
  );
  return rows[0]!.id;
}

async function main(): Promise<void> {
  await migrate();
  await resetDemo();

  const alex = await makeUser('alex@timeline.love', 'Alex', '1994-05-21');
  const mira = await makeUser('mira@timeline.love', 'Mira', '1996-02-29');

  const coupleId = await createCouple(alex, { title: 'Alex & Mira', startedOn: '2024-06-01' });
  const invite = await createInvitation(coupleId, alex);
  await acceptInvitation(invite.code, mira);

  let photoSeed = 0;
  for (const item of story) {
    const author = item.by === 'b' ? mira : alex;
    const event = await createEvent(coupleId, author, {
      type: item.type,
      title: item.title,
      description: item.description ?? null,
      eventDate: item.eventDate,
      endDate: item.endDate ?? null,
      location: item.location ?? null,
      mood: item.mood ?? null,
      tags: item.tags ?? [],
    });
    if (item.photos) {
      const files = await Promise.all(
        Array.from({ length: item.photos }, () => fakePhoto(photoSeed++)),
      );
      await addPhotos(coupleId, author, event.id, files);
    }
  }

  await query(
    `insert into recurring_events (couple_id, kind, title, month, day, start_year, source, created_by)
     values ($1, 'custom', 'The day we met', 3, 12, 2024, 'custom', $2)`,
    [coupleId, alex],
  );

  const count = await queryOne<{ count: string }>('select count(*) as count from events where couple_id = $1', [coupleId]);
  console.log(`[seed] Alex & Mira — ${count?.count} memories.`);
  console.log(`[seed] sign in with alex@timeline.love or mira@timeline.love / ${PASSWORD}`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
