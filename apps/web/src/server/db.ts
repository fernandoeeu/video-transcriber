import { createDb, migrateDb } from "@video-transcriber/db";
import { env } from "@video-transcriber/env/server";

const db = createDb(env.DATABASE_URL);
await migrateDb(db);

export { db };
