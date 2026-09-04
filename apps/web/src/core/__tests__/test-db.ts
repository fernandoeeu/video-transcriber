import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { migrateDb } from "@video-transcriber/db";
import * as schema from "@video-transcriber/db/schema";

const CREATE_VIDEOS_SQL = `
  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    duration INTEGER,
    channel TEXT,
    status TEXT NOT NULL DEFAULT 'fetching_metadata',
    progress INTEGER,
    audio_file_path TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`;

const CREATE_TRANSCRIPTIONS_SQL = `
  CREATE TABLE IF NOT EXISTS transcriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER,
    engine TEXT,
    model TEXT,
    language TEXT,
    segments TEXT,
    source_audio_path TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`;

const CREATE_ACTIVE_TRANSCRIPTION_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS transcriptions_one_active_per_video
  ON transcriptions (video_id)
  WHERE status IN ('queued', 'converting', 'transcribing');
`;

const CREATE_SETTINGS_SQL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/**
 * Create a temporary libsql database for tests.
 * Each call returns a fresh database with the schema applied.
 *
 * The raw SQL mirrors the 0001 baseline (an unbaselined database); the real
 * migrations then run on top, exactly as the server does at startup.
 */
export function createTestDb(dbPath: string) {
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle({ client, schema });

  return {
    db,
    client,
    applySchema: async () => {
      await client.execute("PRAGMA foreign_keys = ON;");
      await client.execute(CREATE_VIDEOS_SQL);
      await client.execute(CREATE_TRANSCRIPTIONS_SQL);
      await client.execute(CREATE_ACTIVE_TRANSCRIPTION_INDEX_SQL);
      await client.execute(CREATE_SETTINGS_SQL);
      await migrateDb(db);
    },
  };
}
