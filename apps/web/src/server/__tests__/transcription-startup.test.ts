import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@video-transcriber/db/schema";
import { eq } from "drizzle-orm";

import { createTestDb } from "../../core/__tests__/test-db";

const processExec = vi.fn();

vi.mock("../../core/process-runner", () => ({
  createProcessRunner: () => ({ exec: processExec }),
}));

vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: vi.fn() },
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalCorsOrigin = process.env.CORS_ORIGIN;
const originalNodeEnv = process.env.NODE_ENV;

async function waitForStatus(
  db: ReturnType<typeof createTestDb>["db"],
  transcriptionId: number,
  expectedStatus: string,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const rows = await db
      .select({ status: schema.transcriptions.status })
      .from(schema.transcriptions)
      .where(eq(schema.transcriptions.id, transcriptionId))
      .limit(1);
    if (rows[0]?.status === expectedStatus) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Transcription ${transcriptionId} did not reach status ${expectedStatus}.`);
}

describe("server transcription startup", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    processExec.mockReset();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCorsOrigin;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("recovers one active job once when the server entry is imported", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-server-startup-test-"));
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    await testDb.applySchema();

    const videos = await testDb.db
      .insert(schema.videos)
      .values({
        originUrl: "https://www.youtube.com/watch?v=server-startup",
        title: "Server startup",
        status: "downloaded",
        audioFilePath: join(tempDir, "audio.opus"),
      })
      .returning();
    const transcriptions = await testDb.db
      .insert(schema.transcriptions)
      .values({
        videoId: videos[0]!.id,
        status: "transcribing",
        progress: 42,
        sourceAudioPath: videos[0]!.audioFilePath,
      })
      .returning();
    const transcriptionId = transcriptions[0]!.id;

    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.CORS_ORIGIN = "http://localhost:3001";
    process.env.NODE_ENV = "test";
    processExec.mockResolvedValue({
      stdout: "",
      stderr: "Recovery test stopped the processor.",
      exitCode: 1,
    });

    await import("../../server.ts");
    await waitForStatus(testDb.db, transcriptionId, "error");

    expect(processExec).toHaveBeenCalledTimes(1);
    expect(processExec).toHaveBeenCalledWith("ffmpeg", expect.any(Array));

    await import("../../server.ts");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(processExec).toHaveBeenCalledTimes(1);
  });
});
