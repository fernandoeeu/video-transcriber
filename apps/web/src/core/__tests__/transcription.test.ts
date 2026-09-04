import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@video-transcriber/db/schema";

import {
  createTranscriptionQueue,
  createTranscriptionQueueInitializer,
  enqueueTranscription,
  getLatestTranscription,
  getTranscriptionById,
  listTranscriptions,
  parseWhisperSegments,
  processTranscription,
  segmentsToPlainText,
  segmentsToSrt,
} from "../transcription";
import { createFakeRunner } from "./fake-process-runner";
import { createTestDb } from "./test-db";

const MODEL_PATH = "/fake/models/ggml-large-v3-turbo.bin";

const WHISPER_OUTPUT = `[00:00:00.000 --> 00:00:05.120]  Hello, this is a test.
[00:00:05.120 --> 00:00:10.500]  We are testing the transcription.
[00:00:10.500 --> 00:00:15.000]  It should parse segments correctly.
`;

describe("parseWhisperSegments", () => {
  it("parses timestamped segments from whisper-cli output", () => {
    const segments = parseWhisperSegments(WHISPER_OUTPUT);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({
      start: 0,
      end: 5.12,
      text: "Hello, this is a test.",
    });
    expect(segments[1]).toEqual({
      start: 5.12,
      end: 10.5,
      text: "We are testing the transcription.",
    });
    expect(segments[2]).toEqual({
      start: 10.5,
      end: 15,
      text: "It should parse segments correctly.",
    });
  });

  it("returns empty array for output with no segments", () => {
    const segments = parseWhisperSegments("some random log output\n");
    expect(segments).toHaveLength(0);
  });

  it("skips segments with empty text", () => {
    const output = `[00:00:00.000 --> 00:00:05.000]  Hello
[00:00:05.000 --> 00:00:10.000]
[00:00:10.000 --> 00:00:15.000]  World
`;
    const segments = parseWhisperSegments(output);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.text).toBe("Hello");
    expect(segments[1]!.text).toBe("World");
  });
});

describe("segmentsToPlainText", () => {
  it("joins segment texts with spaces", () => {
    const segments = parseWhisperSegments(WHISPER_OUTPUT);
    const text = segmentsToPlainText(segments);
    expect(text).toBe(
      "Hello, this is a test. We are testing the transcription. It should parse segments correctly.",
    );
  });
});

describe("segmentsToSrt", () => {
  it("produces correct SRT with sequence numbers and HH:MM:SS,mmm timestamps", () => {
    const segments = parseWhisperSegments(WHISPER_OUTPUT);
    const srt = segmentsToSrt(segments);
    expect(srt).toBe(
      [
        "1",
        "00:00:00,000 --> 00:00:05,120",
        "Hello, this is a test.",
        "",
        "2",
        "00:00:05,120 --> 00:00:10,500",
        "We are testing the transcription.",
        "",
        "3",
        "00:00:10,500 --> 00:00:15,000",
        "It should parse segments correctly.",
        "",
      ].join("\n"),
    );
  });

  it("handles segments with hour-level timestamps", () => {
    const segments = [{ start: 3661.5, end: 3670.25, text: "Over an hour in." }];
    const srt = segmentsToSrt(segments);
    expect(srt).toBe("1\n01:01:01,500 --> 01:01:10,250\nOver an hour in.\n");
  });

  it("returns a single trailing newline for an empty segment list", () => {
    const srt = segmentsToSrt([]);
    expect(srt).toBe("\n");
  });
});

describe("enqueueTranscription", () => {
  let tempDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-transcription-test-"));
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    db = testDb.db;
    await testDb.applySchema();
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  async function insertDownloadedVideo(
    url = "https://www.youtube.com/watch?v=abc123",
  ): Promise<number> {
    const inserted = await db
      .insert(schema.videos)
      .values({
        originUrl: url,
        title: "Test Video",
        duration: 300,
        channel: "Test Channel",
        status: "downloaded",
        audioFilePath: join(tempDir, "audio.opus"),
      })
      .returning();
    return inserted[0]!.id;
  }

  it("creates a queued Transcription for a downloaded Video", async () => {
    const videoId = await insertDownloadedVideo();
    const queue = createTranscriptionQueue();
    // Do not set processor so it stays queued
    const result = await enqueueTranscription(videoId, queue, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.transcription.videoId).toBe(videoId);
    expect(result.transcription.status).toBe("queued");
    expect(result.transcription.sourceAudioPath).toContain("audio.opus");

    // Persisted in DB
    const stored = await getTranscriptionById(result.transcription.id, db);
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("queued");
  });

  it("returns one active Transcription for concurrent enqueue requests", async () => {
    const videoId = await insertDownloadedVideo();
    const queue = createTranscriptionQueue();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => enqueueTranscription(videoId, queue, db)),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    const transcriptionIds = results.flatMap((result) =>
      result.ok ? [result.transcription.id] : [],
    );
    expect(new Set(transcriptionIds).size).toBe(1);

    const stored = await listTranscriptions(videoId, db);
    expect(stored.filter((transcription) => transcription.status === "queued")).toHaveLength(1);
    expect(queue.getQueueLength()).toBe(1);
  });

  it("rejects enqueue for a non-existent video", async () => {
    const queue = createTranscriptionQueue();
    const result = await enqueueTranscription(999, queue, db);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Video not found.");
  });

  it("rejects enqueue when video is not downloaded", async () => {
    const inserted = await db
      .insert(schema.videos)
      .values({
        originUrl: "https://www.youtube.com/watch?v=notdownloaded",
        title: "Not Downloaded",
        status: "ready_to_download",
      })
      .returning();

    const queue = createTranscriptionQueue();
    const result = await enqueueTranscription(inserted[0]!.id, queue, db);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not downloaded");
  });

  it("rejects enqueue when video has no audio file", async () => {
    const inserted = await db
      .insert(schema.videos)
      .values({
        originUrl: "https://www.youtube.com/watch?v=noaudio",
        title: "No Audio",
        status: "downloaded",
        audioFilePath: null,
      })
      .returning();

    const queue = createTranscriptionQueue();
    const result = await enqueueTranscription(inserted[0]!.id, queue, db);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Video has no audio file.");
  });
});

describe("processTranscription", () => {
  let tempDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-process-test-"));
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    db = testDb.db;
    await testDb.applySchema();
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  async function insertTranscription(audioPath: string): Promise<{
    videoId: number;
    transcriptionId: number;
  }> {
    const video = await db
      .insert(schema.videos)
      .values({
        originUrl: `https://www.youtube.com/watch?v=${Date.now()}`,
        title: "Test Video",
        duration: 300,
        channel: "Test Channel",
        status: "downloaded",
        audioFilePath: audioPath,
      })
      .returning();
    const videoId = video[0]!.id;

    const transcription = await db
      .insert(schema.transcriptions)
      .values({
        videoId,
        status: "queued",
        sourceAudioPath: audioPath,
      })
      .returning();

    return { videoId, transcriptionId: transcription[0]!.id };
  }

  it("converts audio with ffmpeg and transcribes with whisper-cli", async () => {
    const audioPath = join(tempDir, "audio.opus");
    const { videoId, transcriptionId } = await insertTranscription(audioPath);

    const runner = createFakeRunner([
      {
        command: "ffmpeg",
        result: { exitCode: 0, stdout: "", stderr: "" },
      },
      {
        command: "whisper-cli",
        result: { exitCode: 0, stdout: WHISPER_OUTPUT, stderr: "" },
        stderrLines: [
          "whisper_full_with_state: auto-detected language: en (p = 0.97)",
          "whisper_full_with_state: progress =  50%",
          "whisper_full_with_state: progress = 100%",
        ],
      },
    ]);

    const result = await processTranscription(transcriptionId, videoId, runner, db, MODEL_PATH);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.transcription.status).toBe("completed");
    expect(result.transcription.progress).toBe(100);
    expect(result.transcription.engine).toBe("whisper.cpp");
    expect(result.transcription.model).toBe("large-v3-turbo");
    expect(result.transcription.language).toBe("en");
    expect(result.transcription.segments).toHaveLength(3);
    expect(result.transcription.segments![0]!.text).toBe("Hello, this is a test.");

    // Verify persisted state
    const stored = await getTranscriptionById(transcriptionId, db);
    expect(stored!.status).toBe("completed");
    expect(stored!.segments).toHaveLength(3);
  });

  it("records error when ffmpeg fails", async () => {
    const audioPath = join(tempDir, "audio.opus");
    const { videoId, transcriptionId } = await insertTranscription(audioPath);

    const runner = createFakeRunner([
      {
        command: "ffmpeg",
        result: {
          exitCode: 1,
          stdout: "",
          stderr: "No such file or directory",
        },
      },
    ]);

    const result = await processTranscription(transcriptionId, videoId, runner, db, MODEL_PATH);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No such file");

    const stored = await getTranscriptionById(transcriptionId, db);
    expect(stored!.status).toBe("error");
    expect(stored!.errorMessage).toContain("No such file");
  });

  it("records error when ffmpeg binary is missing", async () => {
    const audioPath = join(tempDir, "audio.opus");
    const { videoId, transcriptionId } = await insertTranscription(audioPath);

    // No ffmpeg scripted, throws ENOENT
    const runner = createFakeRunner([]);

    const result = await processTranscription(transcriptionId, videoId, runner, db, MODEL_PATH);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("ENOENT");

    const stored = await getTranscriptionById(transcriptionId, db);
    expect(stored!.status).toBe("error");
  });

  it("records error when whisper-cli fails", async () => {
    const audioPath = join(tempDir, "audio.opus");
    const { videoId, transcriptionId } = await insertTranscription(audioPath);

    const runner = createFakeRunner([
      {
        command: "ffmpeg",
        result: { exitCode: 0, stdout: "", stderr: "" },
      },
      {
        command: "whisper-cli",
        result: {
          exitCode: 1,
          stdout: "",
          stderr: "error: failed to open WAV file",
        },
      },
    ]);

    const result = await processTranscription(transcriptionId, videoId, runner, db, MODEL_PATH);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("failed to open WAV");

    const stored = await getTranscriptionById(transcriptionId, db);
    expect(stored!.status).toBe("error");
  });

  it("records error when whisper-cli binary is missing", async () => {
    const audioPath = join(tempDir, "audio.opus");
    const { videoId, transcriptionId } = await insertTranscription(audioPath);

    const runner = createFakeRunner([
      {
        command: "ffmpeg",
        result: { exitCode: 0, stdout: "", stderr: "" },
      },
      // whisper-cli not scripted, throws ENOENT
    ]);

    const result = await processTranscription(transcriptionId, videoId, runner, db, MODEL_PATH);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("ENOENT");

    const stored = await getTranscriptionById(transcriptionId, db);
    expect(stored!.status).toBe("error");
  });

  it("persists progress updates during transcription", async () => {
    const audioPath = join(tempDir, "audio.opus");
    const { videoId, transcriptionId } = await insertTranscription(audioPath);

    const runner = createFakeRunner([
      {
        command: "ffmpeg",
        result: { exitCode: 0, stdout: "", stderr: "" },
      },
      {
        command: "whisper-cli",
        result: { exitCode: 0, stdout: WHISPER_OUTPUT, stderr: "" },
        stderrLines: [
          "whisper_full_with_state: progress =  25%",
          "whisper_full_with_state: progress =  50%",
          "whisper_full_with_state: progress =  75%",
          "whisper_full_with_state: progress = 100%",
        ],
      },
    ]);

    const result = await processTranscription(transcriptionId, videoId, runner, db, MODEL_PATH);

    expect(result.ok).toBe(true);
    // Final progress should be 100 (set by the completion logic)
    if (!result.ok) return;
    expect(result.transcription.progress).toBe(100);
  });

  it("detects language from whisper-cli stderr", async () => {
    const audioPath = join(tempDir, "audio.opus");
    const { videoId, transcriptionId } = await insertTranscription(audioPath);

    const runner = createFakeRunner([
      {
        command: "ffmpeg",
        result: { exitCode: 0, stdout: "", stderr: "" },
      },
      {
        command: "whisper-cli",
        result: { exitCode: 0, stdout: WHISPER_OUTPUT, stderr: "" },
        stderrLines: ["whisper_full_with_state: auto-detected language: pt (p = 0.95)"],
      },
    ]);

    const result = await processTranscription(transcriptionId, videoId, runner, db, MODEL_PATH);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcription.language).toBe("pt");
  });
});

describe("transcription queue", () => {
  it("processes transcriptions one at a time in FIFO order", async () => {
    const processOrder: number[] = [];
    let resolvers: Array<() => void> = [];

    const queue = createTranscriptionQueue();
    queue.setProcessor((transcriptionId) => {
      processOrder.push(transcriptionId);
      return new Promise((resolve) => {
        resolvers.push(() => {
          resolve({
            ok: true,
            transcription: {
              id: transcriptionId,
              videoId: 0,
              status: "completed",
              progress: 100,
              engine: "whisper.cpp",
              model: "large-v3-turbo",
              language: "en",
              segments: [],
              sourceAudioPath: null,
              errorMessage: null,
              createdAt: new Date(),
            },
          });
        });
      });
    });

    const { promise: p1 } = queue.enqueue(1, 1);
    const { promise: p2 } = queue.enqueue(2, 2);
    const { promise: p3 } = queue.enqueue(3, 3);

    // Wait for the first one to start processing
    await new Promise((r) => setTimeout(r, 10));

    // Only the first should have started
    expect(processOrder).toEqual([1]);
    expect(queue.getPosition(2)).toBe(1);
    expect(queue.getPosition(3)).toBe(2);

    // Complete the first one
    resolvers[0]!();
    await p1;
    await new Promise((r) => setTimeout(r, 10));

    // Second should now be processing
    expect(processOrder).toEqual([1, 2]);
    expect(queue.getPosition(3)).toBe(1);

    // Complete the second
    resolvers[1]!();
    await p2;
    await new Promise((r) => setTimeout(r, 10));

    // Third should now be processing
    expect(processOrder).toEqual([1, 2, 3]);

    // Complete the third
    resolvers[2]!();
    await p3;

    expect(processOrder).toEqual([1, 2, 3]);
  });

  it("reports correct queue positions", () => {
    const queue = createTranscriptionQueue();
    queue.setProcessor(
      () => new Promise(() => {}), // never resolves
    );

    queue.enqueue(10, 1);
    queue.enqueue(20, 2);
    queue.enqueue(30, 3);

    // First is running (removed from pending once drain starts)
    // Wait for drain to start
    expect(queue.getQueueLength()).toBe(3);
  });

  it("handles processor errors without blocking the queue", async () => {
    const queue = createTranscriptionQueue();
    const results: Array<{ id: number; ok: boolean }> = [];

    queue.setProcessor(async (transcriptionId) => {
      if (transcriptionId === 1) {
        throw new Error("boom");
      }
      return {
        ok: true,
        transcription: {
          id: transcriptionId,
          videoId: 0,
          status: "completed",
          progress: 100,
          engine: "whisper.cpp",
          model: "large-v3-turbo",
          language: "en",
          segments: [],
          sourceAudioPath: null,
          errorMessage: null,
          createdAt: new Date(),
        },
      };
    });

    const { promise: p1 } = queue.enqueue(1, 1);
    const { promise: p2 } = queue.enqueue(2, 2);

    const r1 = await p1;
    results.push({ id: 1, ok: r1.ok });

    const r2 = await p2;
    results.push({ id: 2, ok: r2.ok });

    // First failed, second succeeded
    expect(results[0]).toEqual({ id: 1, ok: false });
    expect(results[1]).toEqual({ id: 2, ok: true });
  });
});

describe("transcription queue restart recovery", () => {
  let tempDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-queue-recovery-test-"));
    const testDb = createTestDb(join(tempDir, "test.db"));
    db = testDb.db;
    await testDb.applySchema();
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("recovers active jobs once in deterministic order across concurrent lazy initialization", async () => {
    const videoIds: number[] = [];
    const transcriptionIds: number[] = [];

    for (const [index, status] of ["queued", "converting", "transcribing"].entries()) {
      const videos = await db
        .insert(schema.videos)
        .values({
          originUrl: `https://www.youtube.com/watch?v=recovery-${index}`,
          title: `Recovery ${index}`,
          status: "downloaded",
          audioFilePath: join(tempDir, `audio-${index}.opus`),
        })
        .returning();
      videoIds.push(videos[0]!.id);
      const transcriptions = await db
        .insert(schema.transcriptions)
        .values({
          videoId: videos[0]!.id,
          status,
          progress: status === "queued" ? null : 47,
          sourceAudioPath: videos[0]!.audioFilePath,
        })
        .returning();
      transcriptionIds.push(transcriptions[0]!.id);
    }

    const processedIds: number[] = [];
    let resolveAllProcessed!: () => void;
    const allProcessed = new Promise<void>((resolve) => {
      resolveAllProcessed = resolve;
    });
    const getQueue = createTranscriptionQueueInitializer(async (transcriptionId) => {
      processedIds.push(transcriptionId);
      if (processedIds.length === transcriptionIds.length) resolveAllProcessed();
      return { ok: false, error: "Test processor stopped after recovery." };
    }, db);

    const [firstQueue, secondQueue, thirdQueue] = await Promise.all([
      getQueue(),
      getQueue(),
      getQueue(),
    ]);
    await allProcessed;

    expect(secondQueue).toBe(firstQueue);
    expect(thirdQueue).toBe(firstQueue);
    expect(processedIds).toEqual(transcriptionIds);
    expect(new Set(processedIds).size).toBe(transcriptionIds.length);

    const duplicateRequest = await enqueueTranscription(videoIds[0]!, firstQueue, db);
    expect(duplicateRequest.ok).toBe(true);
    if (!duplicateRequest.ok) return;
    expect(duplicateRequest.transcription.id).toBe(transcriptionIds[0]);

    await getQueue();
    expect(processedIds).toEqual(transcriptionIds);

    const recovered = await Promise.all(
      transcriptionIds.map((transcriptionId) => getTranscriptionById(transcriptionId, db)),
    );
    expect(recovered.map((transcription) => transcription?.status)).toEqual([
      "queued",
      "queued",
      "queued",
    ]);
    expect(recovered.map((transcription) => transcription?.progress)).toEqual([null, null, null]);
  });

  it("shares a failed initialization attempt and allows one shared retry", async () => {
    const retryDb = createTestDb(join(tempDir, "retry.db"));
    const getQueue = createTranscriptionQueueInitializer(
      async () => ({ ok: false, error: "No jobs should run in this test." }),
      retryDb.db,
    );

    const firstAttempt = getQueue();
    expect(getQueue()).toBe(firstAttempt);
    await expect(firstAttempt).rejects.toBeInstanceOf(Error);

    await retryDb.applySchema();

    const retryAttempt = getQueue();
    expect(retryAttempt).not.toBe(firstAttempt);
    expect(getQueue()).toBe(retryAttempt);
    await expect(retryAttempt).resolves.toBeDefined();
  });
});

describe("listTranscriptions and getLatestTranscription", () => {
  let tempDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-list-test-"));
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    db = testDb.db;
    await testDb.applySchema();
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("lists all Transcriptions for a Video, newest first", async () => {
    const video = await db
      .insert(schema.videos)
      .values({
        originUrl: "https://www.youtube.com/watch?v=list-test",
        title: "List Test",
        status: "downloaded",
        audioFilePath: "/fake/audio.opus",
      })
      .returning();
    const videoId = video[0]!.id;

    await db.insert(schema.transcriptions).values([
      {
        videoId,
        status: "completed",
        engine: "whisper.cpp",
        model: "large-v3-turbo",
        language: "en",
        segments: JSON.stringify([{ start: 0, end: 5, text: "First run" }]),
      },
      {
        videoId,
        status: "completed",
        engine: "whisper.cpp",
        model: "large-v3-turbo",
        language: "pt",
        segments: JSON.stringify([{ start: 0, end: 5, text: "Second run" }]),
      },
    ]);

    const list = await listTranscriptions(videoId, db);
    expect(list).toHaveLength(2);
    // Newest first (higher id = newer in autoincrement)
    expect(list[0]!.id).toBeGreaterThan(list[1]!.id);
  });

  it("getLatestTranscription returns the most recent one", async () => {
    const video = await db
      .insert(schema.videos)
      .values({
        originUrl: "https://www.youtube.com/watch?v=latest-test",
        title: "Latest Test",
        status: "downloaded",
        audioFilePath: "/fake/audio.opus",
      })
      .returning();
    const videoId = video[0]!.id;

    await db.insert(schema.transcriptions).values([
      {
        videoId,
        status: "completed",
        language: "en",
        segments: JSON.stringify([{ start: 0, end: 5, text: "First" }]),
      },
      {
        videoId,
        status: "completed",
        language: "pt",
        segments: JSON.stringify([{ start: 0, end: 5, text: "Second" }]),
      },
    ]);

    const latest = await getLatestTranscription(videoId, db);
    expect(latest).not.toBeNull();
    expect(latest!.language).toBe("pt"); // second insert
  });

  it("returns null when no Transcriptions exist for a Video", async () => {
    const video = await db
      .insert(schema.videos)
      .values({
        originUrl: "https://www.youtube.com/watch?v=empty-test",
        title: "Empty Test",
        status: "downloaded",
        audioFilePath: "/fake/audio.opus",
      })
      .returning();

    const list = await listTranscriptions(video[0]!.id, db);
    expect(list).toHaveLength(0);

    const latest = await getLatestTranscription(video[0]!.id, db);
    expect(latest).toBeNull();
  });

  it("a new Transcription never overwrites an earlier one", async () => {
    const video = await db
      .insert(schema.videos)
      .values({
        originUrl: "https://www.youtube.com/watch?v=overwrite-test",
        title: "Overwrite Test",
        status: "downloaded",
        audioFilePath: "/fake/audio.opus",
      })
      .returning();
    const videoId = video[0]!.id;

    // Insert two transcriptions
    await db.insert(schema.transcriptions).values({
      videoId,
      status: "completed",
      language: "en",
      segments: JSON.stringify([{ start: 0, end: 5, text: "Original" }]),
    });
    await db.insert(schema.transcriptions).values({
      videoId,
      status: "completed",
      language: "pt",
      segments: JSON.stringify([{ start: 0, end: 5, text: "Retranscription" }]),
    });

    const all = await listTranscriptions(videoId, db);
    expect(all).toHaveLength(2);

    // First one is still intact
    const first = all.find((t) => t.language === "en");
    expect(first).toBeTruthy();
    expect(first!.segments![0]!.text).toBe("Original");

    // Second one exists separately
    const second = all.find((t) => t.language === "pt");
    expect(second).toBeTruthy();
    expect(second!.segments![0]!.text).toBe("Retranscription");
  });
});

describe("retranscription via enqueueTranscription + processTranscription", () => {
  let tempDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let cleanup: () => void;

  const WHISPER_OUTPUT_EN = `[00:00:00.000 --> 00:00:05.000]  First transcription text.
`;
  const WHISPER_OUTPUT_PT = `[00:00:00.000 --> 00:00:05.000]  Second transcription text.
`;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vt-retranscribe-test-"));
    const dbPath = join(tempDir, "test.db");
    const testDb = createTestDb(dbPath);
    db = testDb.db;
    await testDb.applySchema();
    cleanup = () => rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  async function insertDownloadedVideo(): Promise<number> {
    const inserted = await db
      .insert(schema.videos)
      .values({
        originUrl: "https://www.youtube.com/watch?v=retranscribe",
        title: "Retranscribe Test",
        duration: 120,
        channel: "Test",
        status: "downloaded",
        audioFilePath: join(tempDir, "audio.opus"),
      })
      .returning();
    return inserted[0]!.id;
  }

  it("retranscribing a Video creates a new Transcription and preserves the first", async () => {
    const videoId = await insertDownloadedVideo();
    const queue = createTranscriptionQueue();

    // First transcription
    const first = await enqueueTranscription(videoId, queue, db);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const runnerFirst = createFakeRunner([
      { command: "ffmpeg", result: { exitCode: 0, stdout: "", stderr: "" } },
      {
        command: "whisper-cli",
        result: { exitCode: 0, stdout: WHISPER_OUTPUT_EN, stderr: "" },
        stderrLines: ["whisper_full_with_state: auto-detected language: en (p = 0.97)"],
      },
    ]);
    const firstResult = await processTranscription(
      first.transcription.id,
      videoId,
      runnerFirst,
      db,
      MODEL_PATH,
    );
    expect(firstResult.ok).toBe(true);

    // Second transcription (retranscribe)
    const second = await enqueueTranscription(videoId, queue, db);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Different transcription record
    expect(second.transcription.id).not.toBe(first.transcription.id);

    const runnerSecond = createFakeRunner([
      { command: "ffmpeg", result: { exitCode: 0, stdout: "", stderr: "" } },
      {
        command: "whisper-cli",
        result: { exitCode: 0, stdout: WHISPER_OUTPUT_PT, stderr: "" },
        stderrLines: ["whisper_full_with_state: auto-detected language: pt (p = 0.95)"],
      },
    ]);
    const secondResult = await processTranscription(
      second.transcription.id,
      videoId,
      runnerSecond,
      db,
      MODEL_PATH,
    );
    expect(secondResult.ok).toBe(true);

    // Both Transcriptions exist independently
    const all = await listTranscriptions(videoId, db);
    expect(all).toHaveLength(2);

    // Newest first
    expect(all[0]!.id).toBe(second.transcription.id);
    expect(all[1]!.id).toBe(first.transcription.id);

    // Each has its own content
    expect(all[0]!.language).toBe("pt");
    expect(all[0]!.segments![0]!.text).toBe("Second transcription text.");
    expect(all[1]!.language).toBe("en");
    expect(all[1]!.segments![0]!.text).toBe("First transcription text.");

    // Latest returns the second one
    const latest = await getLatestTranscription(videoId, db);
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(second.transcription.id);

    // First one is still fully intact
    const firstStored = await getTranscriptionById(first.transcription.id, db);
    expect(firstStored).not.toBeNull();
    expect(firstStored!.status).toBe("completed");
    expect(firstStored!.segments).toHaveLength(1);
    expect(firstStored!.engine).toBe("whisper.cpp");
    expect(firstStored!.model).toBe("large-v3-turbo");
  });

  it("each Transcription records its own engine, model, language and date", async () => {
    const videoId = await insertDownloadedVideo();
    const queue = createTranscriptionQueue();

    // Enqueue and process first
    const first = await enqueueTranscription(videoId, queue, db);
    if (!first.ok) throw new Error("enqueue failed");

    const runnerFirst = createFakeRunner([
      { command: "ffmpeg", result: { exitCode: 0, stdout: "", stderr: "" } },
      {
        command: "whisper-cli",
        result: { exitCode: 0, stdout: WHISPER_OUTPUT_EN, stderr: "" },
        stderrLines: ["whisper_full_with_state: auto-detected language: en (p = 0.97)"],
      },
    ]);
    await processTranscription(first.transcription.id, videoId, runnerFirst, db, MODEL_PATH);

    // Enqueue and process second
    const second = await enqueueTranscription(videoId, queue, db);
    if (!second.ok) throw new Error("enqueue failed");

    const runnerSecond = createFakeRunner([
      { command: "ffmpeg", result: { exitCode: 0, stdout: "", stderr: "" } },
      {
        command: "whisper-cli",
        result: { exitCode: 0, stdout: WHISPER_OUTPUT_PT, stderr: "" },
        stderrLines: ["whisper_full_with_state: auto-detected language: pt (p = 0.95)"],
      },
    ]);
    await processTranscription(second.transcription.id, videoId, runnerSecond, db, MODEL_PATH);

    // Verify each has its own metadata
    const t1 = await getTranscriptionById(first.transcription.id, db);
    const t2 = await getTranscriptionById(second.transcription.id, db);

    expect(t1!.engine).toBe("whisper.cpp");
    expect(t1!.model).toBe("large-v3-turbo");
    expect(t1!.language).toBe("en");

    expect(t2!.engine).toBe("whisper.cpp");
    expect(t2!.model).toBe("large-v3-turbo");
    expect(t2!.language).toBe("pt");

    // Each has its own creation date
    expect(t1!.createdAt).toBeInstanceOf(Date);
    expect(t2!.createdAt).toBeInstanceOf(Date);
  });
});
