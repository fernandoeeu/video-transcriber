import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createClient } from "@libsql/client";
import { createDb, migrateDb } from "@video-transcriber/db";
import { settings } from "@video-transcriber/db/schema";
import { eq } from "drizzle-orm";

describe("production db-init path", () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-db-init-test-"));
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("creates all tables on a fresh database file", async () => {
    const dbPath = join(tempDir, "fresh.db");
    const url = `file:${dbPath}`;
    const db = createDb(url);
    await migrateDb(db);

    // Verify expected tables exist via sqlite_master using the raw client
    const client = createClient({ url });
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '__drizzle%' ORDER BY name",
    );
    const tableNames = result.rows.map((r) => r.name as string);

    expect(tableNames).toContain("videos");
    expect(tableNames).toContain("transcriptions");
    expect(tableNames).toContain("settings");
  });

  it("allows a settings read on a freshly migrated database", async () => {
    const dbPath = join(tempDir, "settings.db");
    const db = createDb(`file:${dbPath}`);
    await migrateDb(db);

    // The exact query that crashed in production
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "download_folder"))
      .limit(1);

    expect(rows).toEqual([]);
  });

  it("handles an existing unbaselined DB — creates missing tables without crashing", async () => {
    const dbPath = join(tempDir, "unbaselined.db");
    const url = `file:${dbPath}`;

    // Simulate a DB created by db:push with videos + transcriptions but no
    // settings table and no drizzle migrations bookkeeping.
    const rawClient = createClient({ url });
    await rawClient.execute(`
      CREATE TABLE videos (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        origin_url text NOT NULL,
        title text NOT NULL,
        duration integer,
        channel text,
        status text DEFAULT 'fetching_metadata' NOT NULL,
        progress integer,
        audio_file_path text,
        error_message text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      )
    `);
    await rawClient.execute("CREATE UNIQUE INDEX videos_origin_url_unique ON videos (origin_url)");
    await rawClient.execute(`
      CREATE TABLE transcriptions (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        video_id integer NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        status text DEFAULT 'queued' NOT NULL,
        progress integer,
        engine text,
        model text,
        language text,
        segments text,
        source_audio_path text,
        error_message text,
        created_at integer NOT NULL
      )
    `);
    await rawClient.execute(`
      INSERT INTO videos (
        origin_url, title, status, audio_file_path, created_at, updated_at
      ) VALUES (
        'https://example.com/duplicate-active', 'Duplicate active', 'downloaded',
        '/tmp/audio.opus', unixepoch(), unixepoch()
      )
    `);
    await rawClient.execute(`
      INSERT INTO transcriptions (video_id, status, created_at)
      VALUES (1, 'queued', unixepoch()), (1, 'transcribing', unixepoch())
    `);

    // Production init path must succeed on this pre-existing DB
    const db = createDb(url);
    await migrateDb(db);

    // settings table must now exist
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "download_folder"))
      .limit(1);
    expect(rows).toEqual([]);

    const migratedTranscriptions = await rawClient.execute(
      "SELECT status, error_message FROM transcriptions ORDER BY id",
    );
    expect(migratedTranscriptions.rows).toMatchObject([
      {
        status: "error",
        error_message: "Superseded by another active Transcription.",
      },
      { status: "transcribing", error_message: null },
    ]);

    // A second init must be a no-op
    await migrateDb(db);
    const rows2 = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "download_folder"))
      .limit(1);
    expect(rows2).toEqual([]);
  });

  it("handles an unbaselined db:push database with the active transcription index", async () => {
    const dbPath = join(tempDir, "unbaselined-current-schema.db");
    const url = `file:${dbPath}`;

    await migrateDb(createDb(url));

    const rawClient = createClient({ url });
    await rawClient.execute("DROP TABLE settings");
    await rawClient.execute("DROP TABLE __drizzle_migrations");

    const existingIndex = await rawClient.execute(`
      SELECT sql FROM sqlite_master
      WHERE type = 'index' AND name = 'transcriptions_one_active_per_video'
    `);
    expect(existingIndex.rows).toHaveLength(1);
    expect(existingIndex.rows[0]?.sql).toContain("CREATE UNIQUE INDEX");

    const db = createDb(url);
    await migrateDb(db);

    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "download_folder"))
      .limit(1);
    expect(rows).toEqual([]);

    await rawClient.execute(`
      INSERT INTO videos (origin_url, title, created_at, updated_at)
      VALUES ('https://example.com/index-check', 'Index check', unixepoch(), unixepoch())
    `);
    await rawClient.execute(`
      INSERT INTO transcriptions (video_id, status, created_at)
      VALUES (1, 'queued', unixepoch())
    `);
    await expect(
      rawClient.execute(`
        INSERT INTO transcriptions (video_id, status, created_at)
        VALUES (1, 'transcribing', unixepoch())
      `),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    await expect(
      rawClient.execute(`
        INSERT INTO transcriptions (video_id, status, created_at)
        VALUES (1, 'completed', unixepoch())
      `),
    ).resolves.toBeDefined();
  });

  it("is idempotent — migrating twice does not error", async () => {
    const dbPath = join(tempDir, "idempotent.db");
    const db = createDb(`file:${dbPath}`);
    await migrateDb(db);
    await migrateDb(db);

    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "download_folder"))
      .limit(1);

    expect(rows).toEqual([]);
  });
});
