import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ObjectNotFound, type StorageDriver, type StoredObject } from './types.js';

/** Filesystem driver. Simple, single-host, and the default when no object store is configured. */
export function createLocalDriver(uploadDir: string): StorageDriver {
  const root = path.resolve(uploadDir);

  // Keys are app-generated, but treat them as hostile anyway: no traversal, no absolute paths.
  const resolveKey = (key: string): string => {
    const full = path.resolve(root, key);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error('Storage key escapes the upload root');
    }
    return full;
  };

  return {
    name: `local(${root})`,

    async init() {
      await mkdir(root, { recursive: true });
    },

    async put(key, data) {
      const full = resolveKey(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data, { mode: 0o640 });
    },

    async get(key): Promise<StoredObject> {
      const full = resolveKey(key);
      // stat first, so a missing file rejects here instead of erroring mid-pipe.
      try {
        const info = await stat(full);
        return { stream: createReadStream(full), contentLength: info.size };
      } catch {
        throw new ObjectNotFound(key);
      }
    },

    async exists(key) {
      try {
        await stat(resolveKey(key));
        return true;
      } catch {
        return false;
      }
    },

    async remove(key) {
      try {
        await unlink(resolveKey(key));
      } catch {
        /* already gone — deleting a memory should not fail on a missing file */
      }
    },
  };
}
