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
