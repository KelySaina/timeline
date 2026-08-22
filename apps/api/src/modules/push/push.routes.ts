/**
 * Turning notifications on, off, and finding out whether they can be turned on at all.
 *
 * The state endpoint is the one worth explaining. A browser can only answer *its own* half of the
 * question — does it have permission, does it hold a subscription — and the server holds the other
 * half: are keys configured, and is this exact endpoint one we would actually send to. The UI needs
 * both to say anything true, which is why it asks for the endpoint it has rather than a user-wide
 * yes/no: a phone that is subscribed says nothing about the laptop asking.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireUser, verifyCsrf } from '../../middleware/session.js';
import { valid, validate } from '../../middleware/validate.js';
import { badRequest } from '../../lib/errors.js';
import { queryOne, query } from '../../db/pool.js';
import * as push from './push.service.js';
import { SEND_HOUR } from './reminders.js';

export const pushRouter = Router();
pushRouter.use(requireUser);

/**
 * An IANA zone name, checked against the database's own list rather than a regex or Intl. Postgres
 * is what will run `now() at time zone <name>` on every tick, so Postgres is the only opinion that
 * matters — a name it does not know would turn the scheduler's query into a runtime error.
 */
async function validTimezone(name: string): Promise<boolean> {
  const row = await queryOne<{ name: string }>('select name from pg_timezone_names where name = $1', [name]);
  return Boolean(row);
}

const subscriptionBody = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  // Sent by the browser that is subscribing, because it is the only thing that knows. Never asked
  // for in a form: `Intl.DateTimeFormat().resolvedOptions().timeZone` is both more accurate than a
  // person picking from a list and one less question at the moment they said yes.
  timezone: z.string().min(1).max(80).optional(),
  userAgent: z.string().max(400).optional(),
});

const endpointBody = z.object({ endpoint: z.string().url().max(2000) });

pushRouter.get(
  '/push/state',
  validate(z.object({ endpoint: z.string().max(2000).optional() }), 'query'),
  async (req, res) => {
    const { endpoint } = valid<{ endpoint?: string }>(req, 'query');
    const key = push.publicKey();
    res.json({
      // False on an install whose .env has no VAPID pair. Not an error — the SPA hides the
      // affordance rather than offering a switch that cannot do anything.
      configured: key !== null,
      publicKey: key,
      subscribed: endpoint ? await push.hasSubscription(req.user!.id, endpoint) : false,
      // Every device this person has, so a phone can say "also on 1 other device".
      devices: await push.countSubscriptions(req.user!.id),
      // Which kinds they want. Per person rather than per device: "tell me when Vero writes
      // something" is a decision about the relationship, not about which screen is nearest.
      prefs: await push.getPrefs(req.user!.id),
      /** Local hour reminders go out at, so the UI can say when rather than just whether. */
      sendHour: SEND_HOUR,
    });
  },
);

pushRouter.post('/push/subscribe', verifyCsrf, validate(subscriptionBody), async (req, res) => {
  if (!push.publicKey()) throw badRequest('Notifications are not configured on this server');
  const body = valid<z.infer<typeof subscriptionBody>>(req, 'body');

  if (body.timezone) {
    if (!(await validTimezone(body.timezone))) throw badRequest('That is not a timezone this server knows');
    // Kept on the user rather than the couple: partners travel apart, and a reminder should arrive
    // at nine in the morning where the person actually is.
    await query('update users set timezone = $2, updated_at = now() where id = $1', [
      req.user!.id,
      body.timezone,
    ]);
  }

  await push.saveSubscription(req.user!.id, {
    endpoint: body.endpoint,
    keys: body.keys,
    userAgent: body.userAgent ?? null,
  });

  res.status(201).json({ subscribed: true, devices: await push.countSubscriptions(req.user!.id) });
});

pushRouter.delete('/push/subscribe', verifyCsrf, validate(endpointBody), async (req, res) => {
  const { endpoint } = valid<{ endpoint: string }>(req, 'body');
  await push.removeSubscription(req.user!.id, endpoint);
  res.json({ subscribed: false, devices: await push.countSubscriptions(req.user!.id) });
});

const prefsBody = z
  .object({
    reminders: z.boolean().optional(),
    activity: z.boolean().optional(),
    onThisDay: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to change');

pushRouter.patch('/push/prefs', verifyCsrf, validate(prefsBody), async (req, res) => {
  const patch = valid<z.infer<typeof prefsBody>>(req, 'body');
  res.json({ prefs: await push.setPrefs(req.user!.id, patch) });
});

/**
 * Send one to yourself. The only way to find out that notifications are actually working without
 * waiting a week for a real one — and the failure it catches most often is not the server at all
 * but a phone with the app's notifications silenced at OS level, which no amount of permission
 * checking in the browser can see.
 */
pushRouter.post('/push/test', verifyCsrf, async (req, res) => {
  const delivered = await push.sendToUser(req.user!.id, {
    title: 'Notifications are on',
    body: 'This is what a reminder will look like.',
    url: '/upcoming',
    tag: 'test',
  });
  res.json({ delivered });
});
