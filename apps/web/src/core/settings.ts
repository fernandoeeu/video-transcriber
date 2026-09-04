import { join } from "node:path";

import * as schema from "@video-transcriber/db/schema";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";

type Db = LibSQLDatabase<typeof schema>;

const DOWNLOAD_FOLDER_KEY = "download_folder";

/**
 * Read a setting by key. Returns null when the key does not exist.
 */
export async function getSetting(db: Db, key: string): Promise<string | null> {
  const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);

  if (rows.length === 0) return null;
  return rows[0]!.value;
}

/**
 * Write a setting. Inserts or replaces the existing value.
 */
export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  // SQLite upsert: insert or replace on conflict
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

/**
 * Return the configured download folder, falling back to the default
 * media directory under the project root.
 */
export async function getDownloadFolder(db: Db, defaultDir: string): Promise<string> {
  const stored = await getSetting(db, DOWNLOAD_FOLDER_KEY);
  return stored ?? defaultDir;
}

/**
 * Persist a new download folder path.
 */
export async function setDownloadFolder(db: Db, folder: string): Promise<void> {
  await setSetting(db, DOWNLOAD_FOLDER_KEY, folder);
}

/**
 * Compute the default media directory for a given project root.
 */
export function defaultMediaDir(projectRoot: string): string {
  return join(projectRoot, "data", "media");
}
