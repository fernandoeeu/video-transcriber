import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import * as schema from "./schema";

export { schema };

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");

export function createDb(url: string) {
  const client = createClient({ url });

  // SQLite has foreign keys OFF by default; enable them so ON DELETE CASCADE works.
  client.execute("PRAGMA foreign_keys = ON;");

  return drizzle({ client, schema });
}

/**
 * Apply pending migrations so the database schema is up to date.
 * Safe to call repeatedly — already-applied migrations are skipped.
 *
 * A database created with `db:push` already has the current schema but no
 * journal. SQLite has no `ADD COLUMN IF NOT EXISTS`, so the column migration
 * fails with "duplicate column name". That failure proves the schema is
 * current for that column: replay the earlier idempotent migrations, record the
 * journal as fully applied, and continue.
 */
export async function migrateDb(db: Db): Promise<void> {
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } catch (error) {
    if (!isDuplicateColumnError(error)) throw error;
    await baselineJournal(db);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }
}

function isDuplicateColumnError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    if (current.message.includes("duplicate column name")) return true;
    seen.add(current);
    current = current.cause;
  }
  return false;
}

interface Journal {
  entries: { when: number; tag: string }[];
}

function readMigrationSql(tag: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
}

/**
 * Replay every migration before the latest (all idempotent), then mark the
 * latest as applied the same way drizzle's migrator records it.
 */
async function baselineJournal(db: Db): Promise<void> {
  const journal = JSON.parse(
    readFileSync(resolve(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
  ) as Journal;
  const latest = journal.entries.at(-1);
  if (!latest) return;

  for (const entry of journal.entries.slice(0, -1)) {
    for (const statement of readMigrationSql(entry.tag).split("--> statement-breakpoint")) {
      if (statement.trim()) await db.run(sql.raw(statement));
    }
  }

  const hash = createHash("sha256").update(readMigrationSql(latest.tag)).digest("hex");

  await db.run(sql`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`);
  await db.run(
    sql`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (${hash}, ${latest.when})`,
  );
}

export type Db = ReturnType<typeof createDb>;
