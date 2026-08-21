import { env } from '../../../config/env.js';
import { createLocalDriver } from './localDriver.js';
import { createS3Driver } from './s3Driver.js';
import { ObjectNotFound, type StorageDriver, type StoredObject } from './types.js';

export { ObjectNotFound, type StoredObject };

/**
 * One key shape for both drivers, validated in one place: app-generated, but never trusted.
 * A path separator is legal (it is a prefix in S3, a directory locally); traversal is not.
 */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,255}$/;

function assertKey(key: string): string {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Refusing suspicious storage key: ${key}`);
  }
  return key;
}

const driver: StorageDriver =
  env.STORAGE_DRIVER === 's3'
    ? createS3Driver({
        endpoint: env.S3_ENDPOINT!,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      })
    : createLocalDriver(env.UPLOAD_DIR);

export const storageName = driver.name;

/** Called once at boot. Retries, because an object store may still be waking up. */
export async function initStorage(attempts = 20): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await driver.init();
      console.log(`[storage] ready — ${driver.name}`);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.log(`[storage] not ready (${attempt}/${attempts}): ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export const writeObject = (key: string, data: Buffer, contentType = 'image/webp') =>
  driver.put(assertKey(key), data, contentType);

export const readObject = (key: string) => driver.get(assertKey(key));

export const objectExists = (key: string) => driver.exists(assertKey(key));

export const removeObject = (key: string) => driver.remove(assertKey(key));

export const coupleObjectKey = (coupleId: string, photoId: string, variant: 'full' | 'thumb') =>
  `couples/${coupleId}/${photoId}-${variant}.webp`;

export const avatarObjectKey = (userId: string, stamp: string) => `avatars/${userId}-${stamp}.webp`;
