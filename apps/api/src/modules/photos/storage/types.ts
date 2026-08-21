import type { Readable } from 'node:stream';

export type StoredObject = { stream: Readable; contentLength?: number };

/** Thrown when a key is simply not there — callers turn this into a 404, never a 500. */
export class ObjectNotFound extends Error {
  constructor(key: string) {
    super(`No stored object for key ${key}`);
    this.name = 'ObjectNotFound';
  }
}

/**
 * Everything the app needs from a photo store. Two implementations ship: a local filesystem driver
 * for host development, and an S3 driver that talks to MinIO (or S3/R2 — same API, same code).
 */
export type StorageDriver = {
  readonly name: string;
  /** Called once at boot: create the directory or the bucket if it is missing. */
  init(): Promise<void>;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
};
