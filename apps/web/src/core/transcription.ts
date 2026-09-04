import * as schema from "@video-transcriber/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import type { ProcessRunner } from "./process-runner";

type Db = LibSQLDatabase<typeof schema>;

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionData {
  id: number;
  videoId: number;
  status: string;
  progress: number | null;
  engine: string | null;
  model: string | null;
  language: string | null;
  segments: Segment[] | null;
  sourceAudioPath: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface TranscriptionWithQueue extends TranscriptionData {
  queuePosition: number | null;
}

export interface TranscribeSuccess {
  ok: true;
  transcription: TranscriptionData;
}

export interface TranscribeError {
  ok: false;
  error: string;
}

export type TranscribeResult = TranscribeSuccess | TranscribeError;
export type TranscriptionProcessor = (
  transcriptionId: number,
  videoId: number,
) => Promise<TranscribeResult>;

const ACTIVE_TRANSCRIPTION_STATUSES = ["queued", "converting", "transcribing"] as const;

function toTranscriptionData(row: typeof schema.transcriptions.$inferSelect): TranscriptionData {
  return {
    id: row.id,
    videoId: row.videoId,
    status: row.status,
    progress: row.progress ?? null,
    engine: row.engine ?? null,
    model: row.model ?? null,
    language: row.language ?? null,
    segments: row.segments ? JSON.parse(row.segments) : null,
    sourceAudioPath: row.sourceAudioPath ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * In-process transcription queue. Only one transcription runs at a time.
 * Additional requests wait in FIFO order.
 */
export function createTranscriptionQueue() {
  const pending: Array<{
    transcriptionId: number;
    videoId: number;
    resolve: (result: TranscribeResult) => void;
  }> = [];
  let running = false;
  let processFn: TranscriptionProcessor | null = null;

  function setProcessor(fn: TranscriptionProcessor) {
    processFn = fn;
    drain();
  }

  async function drain() {
    if (running || pending.length === 0 || !processFn) return;
    running = true;

    const item = pending.shift()!;
    try {
      const result = await processFn(item.transcriptionId, item.videoId);
      item.resolve(result);
    } catch (err) {
      item.resolve({
        ok: false,
        error: err instanceof Error ? err.message : "Transcription failed.",
      });
    } finally {
      running = false;
      drain();
    }
  }

  function enqueue(
    transcriptionId: number,
    videoId: number,
  ): { promise: Promise<TranscribeResult>; position: number } {
    const position = pending.length + (running ? 1 : 0);
    let resolve!: (result: TranscribeResult) => void;
    const promise = new Promise<TranscribeResult>((r) => {
      resolve = r;
    });
    pending.push({ transcriptionId, videoId, resolve });
    drain();
    return { promise, position };
  }

  function getPosition(transcriptionId: number): number | null {
    if (!running && pending.length === 0) return null;
    const idx = pending.findIndex((p) => p.transcriptionId === transcriptionId);
    if (idx === -1) return null;
    // Position is 1-based: currently running = position 0 (not in pending), first pending = position 1
    return idx + 1;
  }

  function getQueueLength(): number {
    return pending.length + (running ? 1 : 0);
  }

  return { enqueue, getPosition, getQueueLength, setProcessor };
}

export type TranscriptionQueue = ReturnType<typeof createTranscriptionQueue>;

async function initializeTranscriptionQueue(
  processor: TranscriptionProcessor,
  db: Db,
): Promise<TranscriptionQueue> {
  const queue = createTranscriptionQueue();
  const activeTranscriptions = await db
    .select({
      id: schema.transcriptions.id,
      videoId: schema.transcriptions.videoId,
    })
    .from(schema.transcriptions)
    .where(inArray(schema.transcriptions.status, ACTIVE_TRANSCRIPTION_STATUSES))
    .orderBy(asc(schema.transcriptions.createdAt), asc(schema.transcriptions.id));

  if (activeTranscriptions.length > 0) {
    await db
      .update(schema.transcriptions)
      .set({ status: "queued", progress: null, errorMessage: null })
      .where(
        inArray(
          schema.transcriptions.id,
          activeTranscriptions.map((transcription) => transcription.id),
        ),
      );

    for (const transcription of activeTranscriptions) {
      queue.enqueue(transcription.id, transcription.videoId);
    }
  }

  queue.setProcessor(processor);
  return queue;
}

/**
 * Create a concurrency-safe lazy queue initializer. Its first call recovers persisted active
 * Transcriptions before starting the processor; concurrent and later calls reuse the same queue.
 */
export function createTranscriptionQueueInitializer(
  processor: TranscriptionProcessor,
  db: Db,
): () => Promise<TranscriptionQueue> {
  let initialization: Promise<TranscriptionQueue> | undefined;

  return function getQueue() {
    if (!initialization) {
      const pendingInitialization = initializeTranscriptionQueue(processor, db);
      initialization = pendingInitialization;
      void pendingInitialization.catch(() => {
        if (initialization === pendingInitialization) initialization = undefined;
      });
    }
    return initialization;
  };
}

/**
 * Enqueue a new Transcription for a downloaded Video.
 * Returns immediately with the queued Transcription; the actual work runs in the background.
 */
export async function enqueueTranscription(
  videoId: number,
  queue: TranscriptionQueue,
  db: Db,
): Promise<TranscribeResult> {
  // Verify video exists and is downloaded
  const videos = await db
    .select()
    .from(schema.videos)
    .where(eq(schema.videos.id, videoId))
    .limit(1);

  if (videos.length === 0) {
    return { ok: false, error: "Video not found." };
  }

  const video = videos[0]!;
  if (video.status !== "downloaded") {
    return { ok: false, error: `Video is not downloaded (status: ${video.status}).` };
  }

  if (!video.audioFilePath) {
    return { ok: false, error: "Video has no audio file." };
  }

  // Create the Transcription record
  const inserted = await db
    .insert(schema.transcriptions)
    .values({
      videoId,
      status: "queued",
      sourceAudioPath: video.audioFilePath,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    const activeRows = await db
      .select()
      .from(schema.transcriptions)
      .where(
        and(
          eq(schema.transcriptions.videoId, videoId),
          inArray(schema.transcriptions.status, ACTIVE_TRANSCRIPTION_STATUSES),
        ),
      )
      .orderBy(desc(schema.transcriptions.id))
      .limit(1);
    const existing = activeRows[0]
      ? toTranscriptionData(activeRows[0])
      : await getLatestTranscription(videoId, db);

    if (existing) return { ok: true, transcription: existing };
    return { ok: false, error: "Could not find the active Transcription." };
  }

  const transcription = toTranscriptionData(inserted[0]!);

  // Only the request that inserted the record may enqueue it.
  queue.enqueue(transcription.id, videoId);

  return { ok: true, transcription };
}

/**
 * Process a single transcription: convert audio with ffmpeg, run whisper-cli.
 * Called by the queue processor.
 */
export async function processTranscription(
  transcriptionId: number,
  _videoId: number,
  runner: ProcessRunner,
  db: Db,
  modelPath: string,
): Promise<TranscribeResult> {
  const rows = await db
    .select()
    .from(schema.transcriptions)
    .where(eq(schema.transcriptions.id, transcriptionId))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, error: "Transcription not found." };
  }

  const transcription = rows[0]!;
  const audioPath = transcription.sourceAudioPath;
  if (!audioPath) {
    await db
      .update(schema.transcriptions)
      .set({ status: "error", errorMessage: "No source audio path." })
      .where(eq(schema.transcriptions.id, transcriptionId));
    return { ok: false, error: "No source audio path." };
  }

  // Step 1: Convert audio to 16kHz mono WAV with ffmpeg
  await db
    .update(schema.transcriptions)
    .set({ status: "converting", progress: 0 })
    .where(eq(schema.transcriptions.id, transcriptionId));

  const wavPath = audioPath.replace(/\.[^.]+$/, ".wav");

  try {
    const ffmpegResult = await runner.exec("ffmpeg", [
      "-y",
      "-i",
      audioPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      wavPath,
    ]);

    if (ffmpegResult.exitCode !== 0) {
      const errorMessage = ffmpegResult.stderr.trim() || "ffmpeg conversion failed.";
      await db
        .update(schema.transcriptions)
        .set({ status: "error", errorMessage, progress: null })
        .where(eq(schema.transcriptions.id, transcriptionId));
      return { ok: false, error: errorMessage };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "ffmpeg failed.";
    await db
      .update(schema.transcriptions)
      .set({ status: "error", errorMessage, progress: null })
      .where(eq(schema.transcriptions.id, transcriptionId));
    return { ok: false, error: errorMessage };
  }

  // Step 2: Transcribe with whisper-cli
  await db
    .update(schema.transcriptions)
    .set({ status: "transcribing", progress: 0 })
    .where(eq(schema.transcriptions.id, transcriptionId));

  let detectedLanguage: string | null = null;
  let lastPersistedProgress = -1;
  let updateChain = Promise.resolve();

  function handleWhisperLine(line: string) {
    // Parse language detection: "auto-detected language: en (p = 0.97)"
    const langMatch = line.match(/auto-detected language:\s*(\w+)/);
    if (langMatch) {
      detectedLanguage = langMatch[1]!;
    }

    // Parse progress: "whisper_full_with_state: progress = 42%"
    const progressMatch = line.match(/progress\s*=\s*(\d+)%/);
    if (progressMatch) {
      const pct = Number.parseInt(progressMatch[1]!, 10);
      if (pct !== lastPersistedProgress) {
        lastPersistedProgress = pct;
        updateChain = updateChain.then(() =>
          db
            .update(schema.transcriptions)
            .set({ progress: pct })
            .where(eq(schema.transcriptions.id, transcriptionId))
            .then(() => {}),
        );
      }
    }
  }

  try {
    const whisperResult = await runner.exec(
      "whisper-cli",
      ["-m", modelPath, "-l", "auto", "--print-progress", "-f", wavPath],
      { onStderr: handleWhisperLine },
    );

    await updateChain;

    if (whisperResult.exitCode !== 0) {
      const errorMessage = whisperResult.stderr.trim() || "whisper-cli failed.";
      await db
        .update(schema.transcriptions)
        .set({ status: "error", errorMessage, progress: null })
        .where(eq(schema.transcriptions.id, transcriptionId));
      return { ok: false, error: errorMessage };
    }

    // Parse segments from whisper-cli stdout
    const segments = parseWhisperSegments(whisperResult.stdout);

    await db
      .update(schema.transcriptions)
      .set({
        status: "completed",
        progress: 100,
        engine: "whisper.cpp",
        model: "large-v3-turbo",
        language: detectedLanguage,
        segments: JSON.stringify(segments),
      })
      .where(eq(schema.transcriptions.id, transcriptionId));

    const updated = await getTranscriptionById(transcriptionId, db);
    return { ok: true, transcription: updated! };
  } catch (err) {
    await updateChain.catch(() => {});
    const errorMessage = err instanceof Error ? err.message : "Transcription failed.";
    await db
      .update(schema.transcriptions)
      .set({ status: "error", errorMessage, progress: null })
      .where(eq(schema.transcriptions.id, transcriptionId));
    return { ok: false, error: errorMessage };
  }
}

/**
 * Parse whisper-cli stdout into timestamped segments.
 * Expected format: "[00:00:00.000 --> 00:00:05.000]  Some text here"
 */
export function parseWhisperSegments(stdout: string): Segment[] {
  const segments: Segment[] = [];

  for (const line of stdout.split("\n")) {
    const match = line.match(
      /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/,
    );
    if (!match) continue;
    const start = parseTimestamp(match[1]!);
    const end = parseTimestamp(match[2]!);
    const text = match[3]!.trim();
    if (text) {
      segments.push({ start, end, text });
    }
  }

  return segments;
}

/**
 * Parse "HH:MM:SS.mmm" timestamp to seconds.
 */
function parseTimestamp(ts: string): number {
  const [hms, ms] = ts.split(".");
  const [h, m, s] = hms!.split(":").map(Number);
  return h! * 3600 + m! * 60 + s! + Number(ms!) / 1000;
}

/**
 * Get a single Transcription by id.
 */
export async function getTranscriptionById(
  transcriptionId: number,
  db: Db,
): Promise<TranscriptionData | null> {
  const rows = await db
    .select()
    .from(schema.transcriptions)
    .where(eq(schema.transcriptions.id, transcriptionId))
    .limit(1);

  if (rows.length === 0) return null;
  return toTranscriptionData(rows[0]!);
}

/**
 * Get a Transcription with its queue position.
 */
export async function getTranscriptionWithQueue(
  transcriptionId: number,
  queue: TranscriptionQueue,
  db: Db,
): Promise<TranscriptionWithQueue | null> {
  const transcription = await getTranscriptionById(transcriptionId, db);
  if (!transcription) return null;

  const queuePosition =
    transcription.status === "queued" ? queue.getPosition(transcriptionId) : null;

  return { ...transcription, queuePosition };
}

/**
 * List all Transcriptions for a Video, newest first.
 */
export async function listTranscriptions(videoId: number, db: Db): Promise<TranscriptionData[]> {
  const rows = await db
    .select()
    .from(schema.transcriptions)
    .where(eq(schema.transcriptions.videoId, videoId))
    .orderBy(desc(schema.transcriptions.id));

  return rows.map(toTranscriptionData);
}

/**
 * Get the latest Transcription for a Video (by id, most recent insert).
 */
export async function getLatestTranscription(
  videoId: number,
  db: Db,
): Promise<TranscriptionData | null> {
  const rows = await db
    .select()
    .from(schema.transcriptions)
    .where(eq(schema.transcriptions.videoId, videoId))
    .orderBy(desc(schema.transcriptions.id))
    .limit(1);

  if (rows.length === 0) return null;
  return toTranscriptionData(rows[0]!);
}

/**
 * Derive plain text from segments.
 */
export function segmentsToPlainText(segments: Segment[]): string {
  return segments.map((s) => s.text).join(" ");
}

/**
 * Format seconds to SRT timestamp: HH:MM:SS,mmm
 */
function formatSrtTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);

  return (
    [
      h.toString().padStart(2, "0"),
      m.toString().padStart(2, "0"),
      s.toString().padStart(2, "0"),
    ].join(":") +
    "," +
    ms.toString().padStart(3, "0")
  );
}

/**
 * Derive SRT subtitle content from segments.
 * Each entry has a sequence number, timestamps in HH:MM:SS,mmm format, and text.
 */
export function segmentsToSrt(segments: Segment[]): string {
  return (
    segments
      .map((seg, i) => {
        const seq = i + 1;
        const start = formatSrtTimestamp(seg.start);
        const end = formatSrtTimestamp(seg.end);
        return `${seq}\n${start} --> ${end}\n${seg.text}`;
      })
      .join("\n\n") + "\n"
  );
}
