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
  // Push is all three keys or none of them. Half-configured is almost always a typo, and silently
  // disabling notifications because one line is misspelled is the wrong failure.
  const vapid = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;
  if (vapid.some((key) => value[key])) {
    for (const key of vapid) {
      if (!value[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when any VAPID_* key is set` });
      }
    }
  }

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
 * Checked shallowly and on purpose: enough to catch a placeholder pasted in verbatim — neither
 * 'mailto:YOUR_REAL_EMAIL' nor 'mailto:you@your-domain' survives it — and not enough to argue with
 * anyone about what an address may contain.
 */
const usableSubject = (value: string): boolean =>
  /^mailto:[^\s@]+@[^\s@.]+\.[^\s@.]+/.test(value) || /^https:\/\/[^\s]+\.[^\s]+/.test(value);

const hasKeys = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

/**
 * Whether this deployment can send push at all. Everything push-related checks this rather than
 * the keys: an install whose .env has no VAPID pair is a normal, supported state — the endpoints
 * say so honestly and the SPA hides the affordance — not a broken one.
 *
 * A bad subject lands in that same state rather than stopping the process. Refusing to boot would
 * trade every screen of the app for a feature nobody has switched on yet, so the API says loudly
 * what is wrong and carries on without notifications.
 */
export const pushConfigured = hasKeys && usableSubject(env.VAPID_SUBJECT!);

if (hasKeys && !pushConfigured) {
  console.error(
    `[config] VAPID_SUBJECT is not a usable contact URI (${env.VAPID_SUBJECT}) — notifications are ` +
      'disabled until it is a real "mailto:someone@example.com" or an https:// URL. Push services ' +
      'reject anything else, and reject it at send time rather than now.',
  );
}
