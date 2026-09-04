import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { downloadVideoAudio, fetchVideoMetadata, getVideoById } from "../video";
import {
  defaultMediaDir,
  getDownloadFolder,
  getSetting,
  setDownloadFolder,
  setSetting,
} from "../settings";
import { createFakeRunner } from "./fake-process-runner";
import { createTestDb } from "./test-db";

const SAMPLE_METADATA = {
  title: "Settings Test Video",
  duration: 120,
  channel: "Test Channel",
  webpage_url: "https://www.youtube.com/watch?v=settings1",
};

describe("settings", () => {
  let tempDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-settings-test-"));
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    db = testDb.db;
    await testDb.applySchema();
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("returns null for a nonexistent setting", async () => {
    const value = await getSetting(db, "nonexistent");
    expect(value).toBeNull();
  });

  it("stores and retrieves a setting", async () => {
    await setSetting(db, "test_key", "test_value");
    const value = await getSetting(db, "test_key");
    expect(value).toBe("test_value");
  });

  it("overwrites an existing setting", async () => {
    await setSetting(db, "test_key", "first");
    await setSetting(db, "test_key", "second");
    const value = await getSetting(db, "test_key");
    expect(value).toBe("second");
  });

  it("returns the default folder when no download folder is configured", async () => {
    const defaultDir = join(tempDir, "data", "media");
    const folder = await getDownloadFolder(db, defaultDir);
    expect(folder).toBe(defaultDir);
  });

  it("returns the configured folder after setting it", async () => {
    const defaultDir = join(tempDir, "data", "media");
    const customDir = join(tempDir, "custom", "downloads");

    await setDownloadFolder(db, customDir);
    const folder = await getDownloadFolder(db, defaultDir);
    expect(folder).toBe(customDir);
  });

  it("falls back to default after the setting is removed", async () => {
    const defaultDir = join(tempDir, "data", "media");
    const customDir = join(tempDir, "custom", "downloads");

    await setDownloadFolder(db, customDir);
    expect(await getDownloadFolder(db, defaultDir)).toBe(customDir);

    // Remove the setting by deleting the row
    const { eq } = await import("drizzle-orm");
    const { settings } = await import("@video-transcriber/db/schema");
    await db.delete(settings).where(eq(settings.key, "download_folder"));

    expect(await getDownloadFolder(db, defaultDir)).toBe(defaultDir);
  });

  it("computes the default media directory from a project root", () => {
    const dir = defaultMediaDir("/home/user/project");
    expect(dir).toBe(join("/home/user/project", "data", "media"));
  });
});

describe("download uses configured folder", () => {
  let tempDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-settings-dl-test-"));
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    db = testDb.db;
    await testDb.applySchema();
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  async function insertReadyVideo(
    url = "https://www.youtube.com/watch?v=settings1",
  ): Promise<number> {
    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 0,
          stdout: JSON.stringify({ ...SAMPLE_METADATA, webpage_url: url }),
          stderr: "",
        },
      },
    ]);
    const result = await fetchVideoMetadata(url, runner, db);
    if (!result.ok) throw new Error(`Setup failed: ${result.error}`);
    return result.video.id;
  }

  function makeDownloadLines(outputDir: string, title: string) {
    const audioFile = join(outputDir, `${title}.opus`);
    return {
      audioFile,
      stderrLines: [
        `[download] Destination: ${join(outputDir, `${title}.webm`)}`,
        "[download]   0.0% of   5.00MiB at    1.00MiB/s ETA 00:05",
        "[download] 100% of   5.00MiB in 00:02",
        `[ExtractAudio] Destination: ${audioFile}`,
      ],
    };
  }

  it("downloads to the default folder when no setting exists", async () => {
    const defaultDir = join(tempDir, "default-media");
    const videoId = await insertReadyVideo();
    const outputDir = join(defaultDir, String(videoId));
    const { audioFile, stderrLines } = makeDownloadLines(outputDir, "Settings Test Video");

    const mediaDir = await getDownloadFolder(db, defaultDir);

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: stderrLines.join("\n") },
        stderrLines,
      },
    ]);

    const result = await downloadVideoAudio(videoId, runner, db, mediaDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.video.audioFilePath).toBe(audioFile);

    // The directory was created under the default folder
    const entries = readdirSync(defaultDir);
    expect(entries).toContain(String(videoId));
  });

  it("downloads to the configured custom folder", async () => {
    const defaultDir = join(tempDir, "default-media");
    const customDir = join(tempDir, "custom-downloads");

    await setDownloadFolder(db, customDir);

    const videoId = await insertReadyVideo();
    const mediaDir = await getDownloadFolder(db, defaultDir);
    expect(mediaDir).toBe(customDir);

    const outputDir = join(customDir, String(videoId));
    const { audioFile, stderrLines } = makeDownloadLines(outputDir, "Settings Test Video");

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: stderrLines.join("\n") },
        stderrLines,
      },
    ]);

    const result = await downloadVideoAudio(videoId, runner, db, mediaDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.video.audioFilePath).toBe(audioFile);

    // The directory was created under the custom folder, not the default
    const entries = readdirSync(customDir);
    expect(entries).toContain(String(videoId));
  });

  it("previously downloaded Video keeps its file path after folder change", async () => {
    const defaultDir = join(tempDir, "default-media");

    // Download with default folder
    const videoId = await insertReadyVideo();
    const outputDir = join(defaultDir, String(videoId));
    const { audioFile, stderrLines } = makeDownloadLines(outputDir, "Settings Test Video");

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: stderrLines.join("\n") },
        stderrLines,
      },
    ]);

    const result = await downloadVideoAudio(videoId, runner, db, defaultDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const originalPath = result.video.audioFilePath;
    expect(originalPath).toBe(audioFile);

    // Change the download folder
    const newDir = join(tempDir, "new-downloads");
    await setDownloadFolder(db, newDir);

    // The previously downloaded Video still has its original path
    const stored = await getVideoById(videoId, db);
    expect(stored!.audioFilePath).toBe(originalPath);
    expect(stored!.audioFilePath).not.toContain("new-downloads");
  });
});
