import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4281),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  UPLOAD_DIR: z.string().default('/data/uploads'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  WEB_ORIGIN: z.string().default('http://localhost:4280'),

  // Photo storage. 'local' keeps bytes on disk (host development); 's3' talks to MinIO,
  // and to real S3/R2 unchanged.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('timeline-photos'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),

  // Web push. All three optional together: a deploy whose .env predates push must boot and simply
  // not offer it, rather than refuse to start. `scripts/vapid-keys.sh` prints a pair.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // Who a push service should contact about this application. mailto: or https:.
  VAPID_SUBJECT: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.STORAGE_DRIVER !== 's3') return;
  for (const key of ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
    if (!value[key]) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when STORAGE_DRIVER=s3` });
    }
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

/**
 * The VAPID subject is a contact URI for whoever runs this deployment, and it is sent to the push
 * service on every request. A push service rejects a malformed one, so a typo here means every
 * notification fails — but not until one is actually sent, which for a reminder could be next week.
 *
 * Two separate checks, because there are two ways this goes wrong in practice and only the first
 * one looks wrong. `mailto:YOUR_REAL_EMAIL` is obviously broken. `mailto:me@example.com` is a
 * perfectly well-formed address at a domain reserved by RFC 2606 precisely so that it can appear in
 * documentation — which means it is exactly what gets pasted out of documentation, and nothing about
 * its shape gives it away.
 */
const RESERVED_DOMAINS =
  /(^|[@.])(example\.(com|net|org|edu)|your-domain|localhost)$|\.(example|invalid|test|localhost)$/i;

export const usableSubject = (value: string): boolean => {
  const shapedRight =
    /^mailto:[^\s@]+@[^\s@.]+\.[^\s@.]+/.test(value) || /^https:\/\/[^\s]+\.[^\s]+/.test(value);
  if (!shapedRight) return false;
  const host = value.startsWith('mailto:') ? value.slice(value.lastIndexOf('@') + 1) : new URL(value).hostname;
  return !RESERVED_DOMAINS.test(host);
};

/**
 * Whether this deployment can send push at all, and if not, why.
 *
 * Nothing here is ever fatal. Push is one screen's worth of an app that does plenty without it, so
 * every degree of misconfiguration — no keys, half the keys, an unreachable contact address — leaves
 * the API running with notifications off and the reason in the log. An earlier version treated a
 * half-configured pair as a startup error on the grounds that it is probably a typo, which is true
 * and beside the point: the cost of being right that way is the whole site.
 */
function describePush(): { ok: boolean; reason: string | null } {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: key, VAPID_SUBJECT: subject } = env;
  if (!pub && !key && !subject) return { ok: false, reason: null }; // Simply not set up. Not a fault.

  const missing = (['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const).filter(
    (name) => !env[name],
  );
  if (missing.length) {
    return { ok: false, reason: `${missing.join(' and ')} missing — all three are needed together` };
  }
  if (!usableSubject(subject!)) {
    return {
      ok: false,
      reason:
        `VAPID_SUBJECT (${subject}) is not a contact address anyone could reach. It has to be a ` +
        'real mailto: address or an https:// URL — a reserved documentation domain does not count, ' +
        'because a push service accepts it and then has nowhere to write to.',
    };
  }
  return { ok: true, reason: null };
}

const push = describePush();

/**
 * Everything push-related checks this rather than the keys, so an install without them is a normal,
 * supported state: the endpoints say so honestly and the SPA replaces the switch with a sentence.
 */
export const pushConfigured = push.ok;

if (push.reason) console.error(`[config] notifications are off: ${push.reason}`);
