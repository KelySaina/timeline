import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ObjectNotFound, type StorageDriver, type StoredObject } from './types.js';

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

const isMissing = (error: unknown): boolean => {
  const meta = (error as { $metadata?: { httpStatusCode?: number }; name?: string }) ?? {};
  return meta.name === 'NoSuchKey' || meta.name === 'NotFound' || meta.$metadata?.httpStatusCode === 404;
};

/**
 * S3-compatible driver, used against MinIO in this stack.
 *
 * The bucket stays private: nothing here ever sets an ACL or a public policy, and no presigned URL
 * is handed out. Bytes are streamed back through the API so the couple check applies to every
 * request — the same guarantee the filesystem driver gives, just with a network hop.
 */
export function createS3Driver(config: S3Config): StorageDriver {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  return {
    name: `s3(${config.endpoint}/${config.bucket})`,

    async init() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      } catch (error) {
        if (!isMissing(error)) throw error;
        await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
        console.log(`[storage] created bucket ${config.bucket}`);
      }
    },

    async put(key, data, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          ContentLength: data.byteLength,
        }),
      );
    },

    async get(key): Promise<StoredObject> {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        if (!result.Body) throw new ObjectNotFound(key);
        return { stream: result.Body as Readable, contentLength: result.ContentLength };
      } catch (error) {
        if (isMissing(error)) throw new ObjectNotFound(key);
        throw error;
      }
    },

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },

    async remove(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };
}
