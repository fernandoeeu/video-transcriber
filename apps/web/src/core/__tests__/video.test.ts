import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@video-transcriber/db/schema";
import { eq } from "drizzle-orm";

import type { ProcessRunner } from "../process-runner";
import {
  claimVideoAudioDownload,
  deleteVideo,
  downloadVideoAudio,
  fetchVideoMetadata,
  getVideoById,
  listVideos,
  redownloadVideoAudio,
} from "../video";
import { createFakeRunner } from "./fake-process-runner";
import { createTestDb } from "./test-db";

const SAMPLE_METADATA = {
  title: "How to Build a Transcriber",
  duration: 754,
  channel: "Dev Channel",
  uploader: "dev_channel",
  webpage_url: "https://www.youtube.com/watch?v=abc123",
};

describe("fetchVideoMetadata", () => {
  let tempDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-video-test-"));
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    db = testDb.db;
    await testDb.applySchema();
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("fetches metadata via yt-dlp and creates a Video with status ready_to_download", async () => {
    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 0,
          stdout: JSON.stringify(SAMPLE_METADATA),
          stderr: "",
        },
      },
    ]);

    const result = await fetchVideoMetadata("https://www.youtube.com/watch?v=abc123", runner, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.video.title).toBe("How to Build a Transcriber");
    expect(result.video.duration).toBe(754);
    expect(result.video.channel).toBe("Dev Channel");
    expect(result.video.status).toBe("ready_to_download");
    expect(result.video.originUrl).toContain("youtube.com");

    // Video is persisted in the database
    const videos = await listVideos(db);
    expect(videos).toHaveLength(1);
    expect(videos[0]!.title).toBe("How to Build a Transcriber");
    expect(videos[0]!.status).toBe("ready_to_download");
  });

  it("passes --referer to yt-dlp and stores it on the Video", async () => {
    const calls: string[][] = [];
    const inner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 0,
          stdout: JSON.stringify({ ...SAMPLE_METADATA, webpage_url: "https://vimeo.com/123" }),
          stderr: "",
        },
      },
    ]);
    const runner: ProcessRunner = {
      exec(command, args, options) {
        calls.push(args);
        return inner.exec(command, args, options);
      },
    };

    const result = await fetchVideoMetadata(
      "https://player.vimeo.com/video/123#t=10s",
      runner,
      db,
      { refererUrl: "https://school.example.com/lesson-1" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls[0]).toContain("--referer");
    expect(calls[0]).toContain("https://school.example.com/lesson-1");
    // The player URL is kept because the embedding page only allows that URL.
    expect(result.video.originUrl).toBe("https://player.vimeo.com/video/123#t=10s");
    expect(result.video.refererUrl).toBe("https://school.example.com/lesson-1");
  });

  it("asks for the embedding page when Vimeo reports an embed-only video", async () => {
    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 1,
          stdout: "",
          stderr:
            "ERROR: [vimeo] 123: Cannot download embed-only video without embedding URL. Please call yt-dlp with the URL of the page that embeds this video.",
        },
      },
    ]);

    const result = await fetchVideoMetadata("https://player.vimeo.com/video/123", runner, db);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.needsReferer).toBe(true);
    expect(result.error).toContain("embed-only");
    expect(await listVideos(db)).toHaveLength(0);
  });

  it("returns error and creates no record when yt-dlp rejects the URL", async () => {
    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 1,
          stdout: "",
          stderr: "ERROR: Unsupported URL: https://invalid.example.com/nope",
        },
      },
    ]);

    const result = await fetchVideoMetadata("https://invalid.example.com/nope", runner, db);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toContain("Unsupported URL");

    // No broken record in the database
    const videos = await listVideos(db);
    expect(videos).toHaveLength(0);
  });

  it("returns error when yt-dlp process throws (binary not found)", async () => {
    // Empty runner -- yt-dlp not scripted, throws ENOENT
    const runner = createFakeRunner([]);

    const result = await fetchVideoMetadata("https://www.youtube.com/watch?v=abc123", runner, db);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toContain("ENOENT");

    const videos = await listVideos(db);
    expect(videos).toHaveLength(0);
  });

  it("returns error for an empty URL", async () => {
    const runner = createFakeRunner([]);

    const result = await fetchVideoMetadata("", runner, db);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe("URL is empty.");
  });

  it("returns the existing Video with existing flag when the same URL is pasted again", async () => {
    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 0,
          stdout: JSON.stringify(SAMPLE_METADATA),
          stderr: "",
        },
      },
    ]);

    // First paste creates the Video
    const first = await fetchVideoMetadata("https://www.youtube.com/watch?v=abc123", runner, db);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.existing).toBeUndefined();

    // Second paste returns the existing Video without calling yt-dlp again
    const second = await fetchVideoMetadata("https://www.youtube.com/watch?v=abc123", runner, db);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.video.id).toBe(first.video.id);
    expect(second.existing).toBe(true);

    const videos = await listVideos(db);
    expect(videos).toHaveLength(1);
  });

  it("uses uploader field when channel is absent", async () => {
    const metaNoChannel = {
      title: "A Video Without Channel",
      duration: 120,
      uploader: "Some Uploader",
      webpage_url: "https://vimeo.com/12345",
    };

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 0,
          stdout: JSON.stringify(metaNoChannel),
          stderr: "",
        },
      },
    ]);

    const result = await fetchVideoMetadata("https://vimeo.com/12345", runner, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.video.channel).toBe("Some Uploader");
  });

  it("deduplicates when input URL differs from yt-dlp canonical URL", async () => {
    const canonicalUrl = "https://www.youtube.com/watch?v=abc123";
    const shortUrl = "https://youtu.be/abc123";

    const metaWithCanonical = {
      ...SAMPLE_METADATA,
      webpage_url: canonicalUrl,
    };

    // First paste via short URL -- yt-dlp returns the canonical URL
    const firstRunner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 0,
          stdout: JSON.stringify(metaWithCanonical),
          stderr: "",
        },
      },
    ]);

    const first = await fetchVideoMetadata(shortUrl, firstRunner, db);
    expect(first.ok).toBe(true);

    // Second paste of the same short URL -- should return existing Video with existing flag
    const secondRunner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 0,
          stdout: JSON.stringify(metaWithCanonical),
          stderr: "",
        },
      },
    ]);

    const second = await fetchVideoMetadata(shortUrl, secondRunner, db);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.video.id).toBe(first.video.id);
    expect(second.existing).toBe(true);

    const videos = await listVideos(db);
    expect(videos).toHaveLength(1);
  });
});

describe("downloadVideoAudio", () => {
  let tempDir: string;
  let mediaDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-download-test-"));
    mediaDir = join(tempDir, "media");
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    db = testDb.db;
    await testDb.applySchema();
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  /** Insert a video in ready_to_download state for download tests. */
  async function insertReadyVideo(url = "https://www.youtube.com/watch?v=abc123"): Promise<number> {
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
        "[download]  50.0% of   5.00MiB at    2.00MiB/s ETA 00:02",
        "[download] 100% of   5.00MiB in 00:02",
        `[ExtractAudio] Destination: ${audioFile}`,
        `Deleting original file ${join(outputDir, `${title}.webm`)}`,
      ],
    };
  }

  it("passes the stored referer to yt-dlp on download", async () => {
    const setupRunner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: JSON.stringify(SAMPLE_METADATA), stderr: "" },
      },
    ]);
    const preview = await fetchVideoMetadata(
      "https://player.vimeo.com/video/123",
      setupRunner,
      db,
      {
        refererUrl: "https://school.example.com/lesson-1",
      },
    );
    if (!preview.ok) throw new Error(preview.error);

    const calls: string[][] = [];
    const inner = createFakeRunner([
      { command: "yt-dlp", result: { exitCode: 0, stdout: "", stderr: "" } },
    ]);
    const runner: ProcessRunner = {
      exec(command, args, options) {
        calls.push(args);
        return inner.exec(command, args, options);
      },
    };

    const result = await downloadVideoAudio(preview.video.id, runner, db, mediaDir);

    expect(result.ok).toBe(true);
    expect(calls[0]).toContain("--referer");
    expect(calls[0]).toContain("https://school.example.com/lesson-1");
    expect(calls[0]?.at(-1)).toBe("https://player.vimeo.com/video/123");
  });

  it("downloads audio and persists progress updates", async () => {
    const videoId = await insertReadyVideo();
    const outputDir = join(mediaDir, String(videoId));
    const { audioFile, stderrLines } = makeDownloadLines(outputDir, "How to Build a Transcriber");

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

    expect(result.video.status).toBe("downloaded");
    expect(result.video.progress).toBe(100);
    expect(result.video.audioFilePath).toBe(audioFile);
    expect(result.video.errorMessage).toBeNull();

    // Verify persisted state
    const stored = await getVideoById(videoId, db);
    expect(stored!.status).toBe("downloaded");
    expect(stored!.audioFilePath).toBe(audioFile);
  });

  it("records error status when yt-dlp fails", async () => {
    const videoId = await insertReadyVideo();

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 1,
          stdout: "",
          stderr: "ERROR: unable to download video data: HTTP Error 403: Forbidden",
        },
      },
    ]);

    const result = await downloadVideoAudio(videoId, runner, db, mediaDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toContain("403");

    const stored = await getVideoById(videoId, db);
    expect(stored!.status).toBe("error");
    expect(stored!.errorMessage).toContain("403");
    expect(stored!.progress).toBeNull();
  });

  it("passes YouTube player client extractor args to yt-dlp on download", async () => {
    const videoId = await insertReadyVideo("https://www.youtube.com/watch?v=i38DgEuaJwM");
    const outputDir = join(mediaDir, String(videoId));
    let capturedArgs: string[] = [];

    const runner: ProcessRunner = {
      async exec(_command, args, options) {
        capturedArgs = args;
        const stderrLines = [
          `[download] Destination: ${join(outputDir, "Bun v1.4.webm")}`,
          "[download] 100% of   5.00MiB in 00:02",
          `[ExtractAudio] Destination: ${join(outputDir, "Bun v1.4.m4a")}`,
        ];
        for (const line of stderrLines) {
          options?.onStderr?.(line);
        }
        return { exitCode: 0, stdout: "", stderr: stderrLines.join("\n") };
      },
    };

    const result = await downloadVideoAudio(videoId, runner, db, mediaDir);

    expect(result.ok).toBe(true);
    expect(capturedArgs).toEqual(
      expect.arrayContaining(["--extractor-args", "youtube:player_client=android,mweb"]),
    );
  });

  it("records error status when yt-dlp binary is missing", async () => {
    const videoId = await insertReadyVideo();

    // Empty runner: yt-dlp not scripted, throws ENOENT
    const runner = createFakeRunner([]);

    const result = await downloadVideoAudio(videoId, runner, db, mediaDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toContain("ENOENT");

    const stored = await getVideoById(videoId, db);
    expect(stored!.status).toBe("error");
  });

  it("rejects download for a non-existent video", async () => {
    const runner = createFakeRunner([]);
    const result = await downloadVideoAudio(999, runner, db, mediaDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Video not found.");
  });

  it("rejects download when video is not ready_to_download", async () => {
    const videoId = await insertReadyVideo();

    // Simulate already-downloaded status
    const { eq } = await import("drizzle-orm");
    const { videos } = await import("@video-transcriber/db/schema");
    await db.update(videos).set({ status: "downloaded" }).where(eq(videos.id, videoId));

    const runner = createFakeRunner([]);
    const result = await downloadVideoAudio(videoId, runner, db, mediaDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not ready to download");
  });

  it("atomically allows only one concurrent download claim for the same Video", async () => {
    const videoId = await insertReadyVideo();

    const claims = await Promise.all([
      claimVideoAudioDownload(videoId, "download", db),
      claimVideoAudioDownload(videoId, "download", db),
    ]);

    expect(claims.filter((claim) => claim.ok)).toHaveLength(1);
    const rejected = claims.find((claim) => !claim.ok);
    expect(rejected).toEqual({
      ok: false,
      error: "Video is not ready to download (status: downloading).",
    });
    expect((await getVideoById(videoId, db))?.status).toBe("downloading");
  });

  it("falls back to directory scan when no Destination line is parsed", async () => {
    const videoId = await insertReadyVideo();
    const outputDir = join(mediaDir, String(videoId));

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: "" },
        stderrLines: [
          "[download]   0.0% of   5.00MiB at    1.00MiB/s ETA 00:05",
          "[download] 100% of   5.00MiB in 00:02",
        ],
      },
    ]);

    // Simulate yt-dlp creating a file without the Destination line in output
    // The directory is created by downloadVideoAudio, so we write the file
    // in the stderrLines callback's aftermath. Since the fake runner runs
    // synchronously, we can create the directory + file before the scan runs.
    // Actually, downloadVideoAudio creates the dir before exec, so we can
    // use a side-channel to place the file.
    // We'll start the download and check that the fallback scan works.

    // Pre-create the output dir so we can place a file there
    const { mkdirSync } = await import("node:fs");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "audio.opus"), "fake audio data");

    const result = await downloadVideoAudio(videoId, runner, db, mediaDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.video.audioFilePath).toBe(join(outputDir, "audio.opus"));
  });

  it("runs two downloads in parallel without interference", async () => {
    const id1 = await insertReadyVideo("https://www.youtube.com/watch?v=video1");
    const id2 = await insertReadyVideo("https://www.youtube.com/watch?v=video2");

    const dir1 = join(mediaDir, String(id1));
    const dir2 = join(mediaDir, String(id2));
    const lines1 = makeDownloadLines(dir1, "Video One");
    const lines2 = makeDownloadLines(dir2, "Video Two");

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: lines1.stderrLines.join("\n") },
        stderrLines: lines1.stderrLines,
      },
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: lines2.stderrLines.join("\n") },
        stderrLines: lines2.stderrLines,
      },
    ]);

    const [r1, r2] = await Promise.all([
      downloadVideoAudio(id1, runner, db, mediaDir),
      downloadVideoAudio(id2, runner, db, mediaDir),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    // Each video records its own audio file
    expect(r1.video.audioFilePath).toBe(lines1.audioFile);
    expect(r2.video.audioFilePath).toBe(lines2.audioFile);
    expect(r1.video.status).toBe("downloaded");
    expect(r2.video.status).toBe("downloaded");

    // Both exist in the database with correct state
    const allVideos = await listVideos(db);
    expect(allVideos).toHaveLength(2);
    expect(allVideos.every((v) => v.status === "downloaded")).toBe(true);
  });

  it("creates the output directory under the media folder", async () => {
    const videoId = await insertReadyVideo();
    const outputDir = join(mediaDir, String(videoId));
    const { stderrLines } = makeDownloadLines(outputDir, "How to Build a Transcriber");

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: stderrLines.join("\n") },
        stderrLines,
      },
    ]);

    await downloadVideoAudio(videoId, runner, db, mediaDir);

    // Verify the directory was created
    const entries = readdirSync(mediaDir);
    expect(entries).toContain(String(videoId));
  });
});

describe("redownloadVideoAudio", () => {
  let tempDir: string;
  let mediaDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-redownload-test-"));
    mediaDir = join(tempDir, "media");
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    db = testDb.db;
    await testDb.applySchema();
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  /** Insert a video and download it so it reaches "downloaded" state. */
  async function insertDownloadedVideo(
    url = "https://www.youtube.com/watch?v=abc123",
  ): Promise<number> {
    const metaRunner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 0,
          stdout: JSON.stringify({ ...SAMPLE_METADATA, webpage_url: url }),
          stderr: "",
        },
      },
    ]);
    const preview = await fetchVideoMetadata(url, metaRunner, db);
    if (!preview.ok) throw new Error(`Setup failed: ${preview.error}`);
    const videoId = preview.video.id;

    const outputDir = join(mediaDir, String(videoId));
    const audioFile = join(outputDir, "audio.opus");
    const stderrLines = [
      `[download] Destination: ${join(outputDir, "audio.webm")}`,
      "[download] 100% of   5.00MiB in 00:02",
      `[ExtractAudio] Destination: ${audioFile}`,
    ];

    const dlRunner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: stderrLines.join("\n") },
        stderrLines,
      },
    ]);
    const dlResult = await downloadVideoAudio(videoId, dlRunner, db, mediaDir);
    if (!dlResult.ok) throw new Error(`Download setup failed: ${dlResult.error}`);
    return videoId;
  }

  /** Insert a video that failed to download (status = "error"). */
  async function insertErroredVideo(
    url = "https://www.youtube.com/watch?v=err123",
  ): Promise<number> {
    const metaRunner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 0,
          stdout: JSON.stringify({ ...SAMPLE_METADATA, webpage_url: url }),
          stderr: "",
        },
      },
    ]);
    const preview = await fetchVideoMetadata(url, metaRunner, db);
    if (!preview.ok) throw new Error(`Setup failed: ${preview.error}`);
    const videoId = preview.video.id;

    const dlRunner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 1, stdout: "", stderr: "ERROR: network failure" },
      },
    ]);
    await downloadVideoAudio(videoId, dlRunner, db, mediaDir);
    return videoId;
  }

  it("re-downloads audio for a downloaded Video", async () => {
    const videoId = await insertDownloadedVideo();

    const outputDir = join(mediaDir, String(videoId));
    const newAudioFile = join(outputDir, "refreshed.opus");
    const stderrLines = [
      `[download] Destination: ${join(outputDir, "refreshed.webm")}`,
      "[download] 100% of   5.00MiB in 00:01",
      `[ExtractAudio] Destination: ${newAudioFile}`,
    ];

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: stderrLines.join("\n") },
        stderrLines,
      },
    ]);

    const result = await redownloadVideoAudio(videoId, runner, db, mediaDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.video.status).toBe("downloaded");
    expect(result.video.progress).toBe(100);
    expect(result.video.audioFilePath).toBe(newAudioFile);
    expect(result.video.errorMessage).toBeNull();
  });

  it("re-downloads audio for an errored Video", async () => {
    const videoId = await insertErroredVideo();

    // Verify it's in error state before re-download
    const before = await getVideoById(videoId, db);
    expect(before!.status).toBe("error");

    const outputDir = join(mediaDir, String(videoId));
    const audioFile = join(outputDir, "recovered.opus");
    const stderrLines = [
      `[download] Destination: ${join(outputDir, "recovered.webm")}`,
      "[download] 100% of   5.00MiB in 00:01",
      `[ExtractAudio] Destination: ${audioFile}`,
    ];

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 0, stdout: "", stderr: stderrLines.join("\n") },
        stderrLines,
      },
    ]);

    const result = await redownloadVideoAudio(videoId, runner, db, mediaDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.video.status).toBe("downloaded");
    expect(result.video.audioFilePath).toBe(audioFile);
    expect(result.video.errorMessage).toBeNull();
  });

  it("atomically allows only one concurrent re-download claim for the same Video", async () => {
    const videoId = await insertDownloadedVideo();

    const claims = await Promise.all([
      claimVideoAudioDownload(videoId, "redownload", db),
      claimVideoAudioDownload(videoId, "redownload", db),
    ]);

    expect(claims.filter((claim) => claim.ok)).toHaveLength(1);
    const rejected = claims.find((claim) => !claim.ok);
    expect(rejected).toEqual({
      ok: false,
      error: "Video cannot be re-downloaded (status: downloading).",
    });
    expect((await getVideoById(videoId, db))?.status).toBe("downloading");
  });

  it("rejects re-download for a Video still in ready_to_download state", async () => {
    const metaRunner = createFakeRunner([
      {
        command: "yt-dlp",
        result: {
          exitCode: 0,
          stdout: JSON.stringify(SAMPLE_METADATA),
          stderr: "",
        },
      },
    ]);
    const preview = await fetchVideoMetadata(
      "https://www.youtube.com/watch?v=abc123",
      metaRunner,
      db,
    );
    if (!preview.ok) throw new Error("Setup failed");

    const runner = createFakeRunner([]);
    const result = await redownloadVideoAudio(preview.video.id, runner, db, mediaDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("cannot be re-downloaded");
  });

  it("rejects re-download for a non-existent Video", async () => {
    const runner = createFakeRunner([]);
    const result = await redownloadVideoAudio(999, runner, db, mediaDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Video not found.");
  });

  it("records error when re-download fails", async () => {
    const videoId = await insertDownloadedVideo();

    const runner = createFakeRunner([
      {
        command: "yt-dlp",
        result: { exitCode: 1, stdout: "", stderr: "ERROR: video unavailable" },
      },
    ]);

    const result = await redownloadVideoAudio(videoId, runner, db, mediaDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("video unavailable");

    const stored = await getVideoById(videoId, db);
    expect(stored!.status).toBe("error");
    expect(stored!.errorMessage).toContain("video unavailable");
  });
});

describe("deleteVideo", () => {
  let tempDir: string;
  let mediaDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let secondDb: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-delete-test-"));
    mediaDir = join(tempDir, "media");
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    db = testDb.db;
    await testDb.applySchema();
    secondDb = createTestDb(dbPath).db;
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  /** Insert a video in ready_to_download state. */
  async function insertVideo(url = "https://www.youtube.com/watch?v=abc123"): Promise<number> {
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

  function createBlockedDownloadRunner(audioPath: string): {
    runner: ProcessRunner;
    started: Promise<void>;
    finish: () => void;
  } {
    let signalStarted: () => void = () => {};
    let finish: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const canFinish = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const runner: ProcessRunner = {
      async exec(_command, _args, options) {
        signalStarted();
        await canFinish;
        options?.onStderr?.(`[ExtractAudio] Destination: ${audioPath}`);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    return { runner, started, finish };
  }

  it("removes the Video record from the database", async () => {
    const videoId = await insertVideo();

    const result = await deleteVideo(videoId, db);

    expect(result.ok).toBe(true);

    const stored = await getVideoById(videoId, db);
    expect(stored).toBeNull();

    const all = await listVideos(db);
    expect(all).toHaveLength(0);
  });

  it("cascades deletion to Transcriptions", async () => {
    const videoId = await insertVideo();

    // Insert two Transcriptions for this Video
    await db.insert(schema.transcriptions).values({
      videoId,
      engine: "whisper.cpp",
      model: "large-v3-turbo",
      language: "en",
      segments: JSON.stringify([{ start: 0, end: 5, text: "Hello" }]),
      status: "completed",
      sourceAudioPath: "/fake/audio.wav",
    });
    await db.insert(schema.transcriptions).values({
      videoId,
      engine: "whisper.cpp",
      model: "large-v3-turbo",
      language: "pt",
      segments: JSON.stringify([{ start: 0, end: 5, text: "Ola" }]),
      status: "completed",
      sourceAudioPath: "/fake/audio.wav",
    });

    // Verify Transcriptions exist
    const before = await db.select().from(schema.transcriptions);
    expect(before).toHaveLength(2);

    const result = await deleteVideo(videoId, db);
    expect(result.ok).toBe(true);

    // Transcriptions should be gone
    const after = await db.select().from(schema.transcriptions);
    expect(after).toHaveLength(0);
  });

  it("removes the Video folder on disk", async () => {
    const videoId = await insertVideo();

    // Create the media folder and a fake audio file
    const videoDir = join(mediaDir, String(videoId));
    mkdirSync(videoDir, { recursive: true });
    const audioPath = join(videoDir, "audio.opus");
    writeFileSync(audioPath, "fake audio data");
    expect(existsSync(videoDir)).toBe(true);

    // Set audioFilePath so deleteVideo can derive the directory
    await db
      .update(schema.videos)
      .set({ audioFilePath: audioPath })
      .where(eq(schema.videos.id, videoId));

    const result = await deleteVideo(videoId, db);
    expect(result.ok).toBe(true);

    expect(existsSync(videoDir)).toBe(false);
  });

  it("succeeds even when no folder exists on disk", async () => {
    const videoId = await insertVideo();

    // No media folder created -- delete should still work
    const result = await deleteVideo(videoId, db);
    expect(result.ok).toBe(true);

    const stored = await getVideoById(videoId, db);
    expect(stored).toBeNull();
  });

  it("returns error for a non-existent Video", async () => {
    const result = await deleteVideo(999, db);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Video not found.");
  });

  it("refuses deletion from another tab while a download is running", async () => {
    const videoId = await insertVideo();
    const audioPath = join(mediaDir, String(videoId), "audio.opus");
    const blocked = createBlockedDownloadRunner(audioPath);

    const pendingDownload = downloadVideoAudio(videoId, blocked.runner, db, mediaDir);
    await blocked.started;

    const deletion = await deleteVideo(videoId, secondDb);
    blocked.finish();
    const download = await pendingDownload;

    expect(deletion).toEqual({
      ok: false,
      error: "Video cannot be deleted while its audio is downloading.",
    });
    expect(download.ok).toBe(true);
    if (!download.ok) return;
    expect(download.video).not.toBeNull();
    expect(download.video.status).toBe("downloaded");
    expect((await getVideoById(videoId, secondDb))?.status).toBe("downloaded");
  });

  it("does not report success with a null Video if the row disappears", async () => {
    const videoId = await insertVideo();
    const audioPath = join(mediaDir, String(videoId), "audio.opus");
    const blocked = createBlockedDownloadRunner(audioPath);

    const pendingDownload = downloadVideoAudio(videoId, blocked.runner, db, mediaDir);
    await blocked.started;
    await secondDb.delete(schema.videos).where(eq(schema.videos.id, videoId));
    blocked.finish();

    expect(await pendingDownload).toEqual({
      ok: false,
      error: "Video no longer exists.",
    });
  });

  it("does not let a stale downloader overwrite a newer status", async () => {
    const videoId = await insertVideo();
    const audioPath = join(mediaDir, String(videoId), "audio.opus");
    const blocked = createBlockedDownloadRunner(audioPath);

    const pendingDownload = downloadVideoAudio(videoId, blocked.runner, db, mediaDir);
    await blocked.started;
    await secondDb
      .update(schema.videos)
      .set({ status: "error", progress: null, errorMessage: "Cancelled elsewhere." })
      .where(eq(schema.videos.id, videoId));
    blocked.finish();

    const result = await pendingDownload;

    expect(result).toEqual({
      ok: false,
      error: "Video download is no longer active (status: error).",
    });
    expect(await getVideoById(videoId, secondDb)).toMatchObject({
      status: "error",
      progress: null,
      errorMessage: "Cancelled elsewhere.",
    });
  });

  it("does not affect other Videos when deleting one", async () => {
    const id1 = await insertVideo("https://www.youtube.com/watch?v=video1");
    const id2 = await insertVideo("https://www.youtube.com/watch?v=video2");

    const result = await deleteVideo(id1, db);
    expect(result.ok).toBe(true);

    // First video is gone
    expect(await getVideoById(id1, db)).toBeNull();

    // Second video is untouched
    const remaining = await getVideoById(id2, db);
    expect(remaining).not.toBeNull();
    expect(remaining!.title).toBe(SAMPLE_METADATA.title);

    const all = await listVideos(db);
    expect(all).toHaveLength(1);
  });
});
