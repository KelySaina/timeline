import { randomUUID } from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { badRequest, HttpError } from '../../lib/errors.js';
import { avatarObjectKey, coupleObjectKey, removeObject, writeObject } from './storage/index.js';

const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS_PER_EVENT = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: MAX_PHOTOS_PER_EVENT },
});

export const photoUpload = upload.array('photos', MAX_PHOTOS_PER_EVENT);
export const avatarUpload = upload.single('avatar');

export type StoredPhoto = {
  id: string;
  storageKey: string;
  thumbKey: string;
  width: number;
  height: number;
  byteSize: number;
};

/**
 * Decode, strip metadata, re-encode. The client's declared mime type is never trusted:
 * if sharp cannot decode it, it is not an image, whatever the header said.
 */
async function transcode(buffer: Buffer, maxWidth: number, quality: number) {
  try {
    const image = sharp(buffer, { failOn: 'error' }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height) throw badRequest('That file is not an image we can read');

    const out = await image
      .resize({ width: Math.min(meta.width, maxWidth), withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });

    return { data: out.data, width: out.info.width, height: out.info.height };
  } catch (error) {
    // A decoder failure means the bytes are not an image, whatever the filename or mime said.
    if (error instanceof HttpError) throw error;
    throw badRequest('We could not read that file as an image — try a JPEG, PNG, HEIC or WebP');
  }
}

export async function storeEventPhoto(coupleId: string, file: Express.Multer.File): Promise<StoredPhoto> {
  const id = randomUUID();
  const storageKey = coupleObjectKey(coupleId, id, 'full');
  const thumbKey = coupleObjectKey(coupleId, id, 'thumb');

  const full = await transcode(file.buffer, 2000, 82);
  const thumb = await transcode(file.buffer, 720, 70);

  await writeObject(storageKey, full.data);
  try {
    await writeObject(thumbKey, thumb.data);
  } catch (error) {
    await removeObject(storageKey);
    throw error;
  }

  return {
    id,
    storageKey,
    thumbKey,
    width: full.width,
    height: full.height,
    byteSize: full.data.byteLength,
  };
}

export async function storeAvatar(userId: string, file: Express.Multer.File | undefined): Promise<string> {
  if (!file) throw badRequest('Pick a photo first');
  const key = avatarObjectKey(userId, Date.now().toString(36));
  const square = await sharp(file.buffer, { failOn: 'error' })
    .rotate()
    .resize(320, 320, { fit: 'cover', position: 'centre' })
    .webp({ quality: 80 })
    .toBuffer();
  await writeObject(key, square);
  return key;
}
