import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import * as schema from "@video-transcriber/db/schema";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, eq, inArray, ne } from "drizzle-orm";

import type { ProcessRunner } from "./process-runner";

type Db = LibSQLDatabase<typeof schema>;

/**
 * YouTube's default android_vr client often selects webm formats whose CDN URLs
 * return HTTP 403. android and mweb clients serve downloadable progressive formats.
 */
const YT_DLP_YOUTUBE_EXTRACTOR_ARGS = [
  "--extractor-args",
  "youtube:player_client=android,mweb",
] as const;

const VIMEO_EMBED_ONLY_MARKER = "Cannot download embed-only video without embedding URL";

export const VIMEO_EMBED_ONLY_ERROR =
  'This Vimeo video is embed-only. Paste the URL of the page that embeds it in the "Embedding page URL" field and try again.';

export interface VideoMetadata {
  id: number;
  originUrl: string;
  refererUrl: string | null;
  title: string;
  duration: number | null;
  channel: string | null;
  status: string;
  progress: number | null;
  audioFilePath: string | null;
  errorMessage: string | null;
}

export interface VideoPreviewResult {
  ok: true;
  video: VideoMetadata;
  /** True when the Video already existed (duplicate URL). */
  existing?: boolean;
}

export interface VideoPreviewError {
  ok: false;
  error: string;
  /** True when yt-dlp needs the URL of the page that embeds the video. */
  needsReferer?: boolean;
}

export interface FetchVideoMetadataOptions {
  /** Page that embeds the video. Required by Vimeo for embed-only videos. */
  refererUrl?: string;
}

export type PreviewResult = VideoPreviewResult | VideoPreviewError;

export interface DownloadSuccess {
  ok: true;
  video: VideoMetadata;
}

export interface DownloadError {
  ok: false;
  error: string;
}

export type DownloadResult = DownloadSuccess | DownloadError;
export type DownloadRequest = "download" | "redownload";

interface YtDlpMetadata {
  title?: string;
  duration?: number;
  channel?: string;
  uploader?: string;
  webpage_url?: string;
}

function toVideoMetadata(v: typeof schema.videos.$inferSelect): VideoMetadata {
  return {
    id: v.id,
    originUrl: v.originUrl,
    refererUrl: v.refererUrl ?? null,
    title: v.title,
    duration: v.duration,
    channel: v.channel,
    status: v.status,
    progress: v.progress ?? null,
    audioFilePath: v.audioFilePath ?? null,
    errorMessage: v.errorMessage ?? null,
  };
}

/**
 * Fetch metadata for a URL via yt-dlp (no download) and persist the Video.
 * Returns the Video metadata on success or yt-dlp's error message on failure.
 */
export async function fetchVideoMetadata(
  url: string,
  runner: ProcessRunner,
  db: Db,
  options: FetchVideoMetadataOptions = {},
): Promise<PreviewResult> {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: "URL is empty." };
  }
  const refererUrl = options.refererUrl?.trim() || null;

  // Check for duplicate URL before calling yt-dlp
  const normalized = normalizeUrl(trimmed);
  const existing = await db
    .select()
    .from(schema.videos)
    .where(eq(schema.videos.originUrl, normalized))
    .limit(1);

  if (existing.length > 0) {
    return { ok: true, video: toVideoMetadata(existing[0]!), existing: true };
  }

  const result = await runner
    .exec("yt-dlp", ["--dump-json", "--no-download", ...refererArgs(refererUrl), trimmed])
    .catch((err: Error) => ({
      exitCode: 1,
      stdout: "",
      stderr: err.message,
    }));

  if (result.exitCode !== 0) {
    const message = result.stderr.trim() || "yt-dlp failed with no output.";
    if (message.includes(VIMEO_EMBED_ONLY_MARKER)) {
      return { ok: false, error: VIMEO_EMBED_ONLY_ERROR, needsReferer: true };
    }
    return { ok: false, error: message };
  }

  let meta: YtDlpMetadata;
  try {
    meta = JSON.parse(result.stdout);
  } catch {
    return { ok: false, error: "Failed to parse yt-dlp output." };
  }

  const title = meta.title ?? "Untitled";
  const duration = meta.duration ?? null;
  const channel = meta.channel ?? meta.uploader ?? null;
  // With a referer, the download must reuse the exact URL the embedding page allows.
  const originUrl = normalizeUrl(refererUrl ? trimmed : (meta.webpage_url ?? trimmed));

  // Check again with canonical URL (handles URL aliases like youtu.be -> youtube.com)
  if (originUrl !== normalized) {
    const existingCanonical = await db
      .select()
      .from(schema.videos)
      .where(eq(schema.videos.originUrl, originUrl))
      .limit(1);

    if (existingCanonical.length > 0) {
      return { ok: true, video: toVideoMetadata(existingCanonical[0]!), existing: true };
    }
  }

  const inserted = await db
    .insert(schema.videos)
    .values({
      originUrl,
      refererUrl,
      title,
      duration,
      channel,
      status: "ready_to_download",
    })
    .returning();

  return { ok: true, video: toVideoMetadata(inserted[0]!) };
}

/**
 * Get a single Video by id.
 */
export async function getVideoById(videoId: number, db: Db): Promise<VideoMetadata | null> {
  const rows = await db.select().from(schema.videos).where(eq(schema.videos.id, videoId)).limit(1);

  if (rows.length === 0) return null;
  return toVideoMetadata(rows[0]!);
}

/**
 * List all Videos ordered by id (oldest first).
 */
export async function listVideos(db: Db): Promise<VideoMetadata[]> {
  const rows = await db.select().from(schema.videos).orderBy(schema.videos.id);
  return rows.map(toVideoMetadata);
}

/**
 * Atomically claim a Video for download before starting external work.
 * Only one caller can move an eligible Video to downloading.
 */
export async function claimVideoAudioDownload(
  videoId: number,
  request: DownloadRequest,
  db: Db,
): Promise<DownloadResult> {
  const eligibleStatus =
    request === "download"
      ? eq(schema.videos.status, "ready_to_download")
      : inArray(schema.videos.status, ["downloaded", "error"]);
  const claimed = await db
    .update(schema.videos)
    .set({ status: "downloading", progress: 0, errorMessage: null })
    .where(and(eq(schema.videos.id, videoId), eligibleStatus))
    .returning();

  if (claimed[0]) {
    return { ok: true, video: toVideoMetadata(claimed[0]) };
  }

  const video = await getVideoById(videoId, db);
  if (!video) return { ok: false, error: "Video not found." };

  return request === "download"
    ? {
        ok: false,
        error: `Video is not ready to download (status: ${video.status}).`,
      }
    : {
        ok: false,
        error: `Video cannot be re-downloaded (status: ${video.status}).`,
      };
}

/**
 * Execute yt-dlp for a Video that was already atomically claimed.
 * Persists progress and the final audio file path.
 */
export async function runClaimedVideoAudioDownload(
  video: VideoMetadata,
  runner: ProcessRunner,
  db: Db,
  mediaDir: string,
): Promise<DownloadResult> {
  const videoId = video.id;
  const outputDir = join(mediaDir, String(videoId));
  let updateChain = Promise.resolve();
  let lastPersistedProgress = -1;
  let audioFilePath: string | null = null;

  function handleLine(line: string) {
    const progressMatch = line.match(/\[download\]\s+([\d.]+)%/);
    if (progressMatch) {
      const pct = Math.round(Number.parseFloat(progressMatch[1]!));
      if (pct !== lastPersistedProgress) {
        lastPersistedProgress = pct;
        updateChain = updateChain.then(() =>
          db
            .update(schema.videos)
            .set({ progress: pct })
            .where(and(eq(schema.videos.id, videoId), eq(schema.videos.status, "downloading")))
            .then(() => {}),
        );
      }
    }

    const destMatch = line.match(/Destination:\s*(.+)/);
    if (destMatch) {
      audioFilePath = destMatch[1]!.trim();
    }
  }

  try {
    mkdirSync(outputDir, { recursive: true });
    const result = await runner.exec(
      "yt-dlp",
      [
        "-x",
        "--no-playlist",
        "--newline",
        ...YT_DLP_YOUTUBE_EXTRACTOR_ARGS,
        ...refererArgs(video.refererUrl),
        "-o",
        join(outputDir, "%(title)s.%(ext)s"),
        video.originUrl,
      ],
      { onStdout: handleLine, onStderr: handleLine },
    );

    await updateChain;

    if (result.exitCode !== 0) {
      const errorMessage = result.stderr.trim() || "yt-dlp download failed.";
      await db
        .update(schema.videos)
        .set({ status: "error", errorMessage, progress: null })
        .where(and(eq(schema.videos.id, videoId), eq(schema.videos.status, "downloading")));
      return { ok: false, error: errorMessage };
    }

    if (!audioFilePath) {
      const files = readdirSync(outputDir);
      if (files.length > 0) {
        audioFilePath = join(outputDir, files[0]!);
      }
    }

    const completed = await db
      .update(schema.videos)
      .set({ status: "downloaded", progress: 100, audioFilePath })
      .where(and(eq(schema.videos.id, videoId), eq(schema.videos.status, "downloading")))
      .returning();

    if (!completed[0]) {
      const current = await getVideoById(videoId, db);
      if (!current) {
        return { ok: false, error: "Video no longer exists." };
      }
      return {
        ok: false,
        error: `Video download is no longer active (status: ${current.status}).`,
      };
    }

    return { ok: true, video: toVideoMetadata(completed[0]) };
  } catch (err) {
    await updateChain.catch(() => {});
    const errorMessage = err instanceof Error ? err.message : "Download failed.";
    await db
      .update(schema.videos)
      .set({ status: "error", errorMessage, progress: null })
      .where(and(eq(schema.videos.id, videoId), eq(schema.videos.status, "downloading")));
    return { ok: false, error: errorMessage };
  }
}

/**
 * Claim and download audio for a ready Video.
 */
export async function downloadVideoAudio(
  videoId: number,
  runner: ProcessRunner,
  db: Db,
  mediaDir: string,
): Promise<DownloadResult> {
  const claim = await claimVideoAudioDownload(videoId, "download", db);
  if (!claim.ok) return claim;
  return runClaimedVideoAudioDownload(claim.video, runner, db, mediaDir);
}

export interface DeleteSuccess {
  ok: true;
}

export interface DeleteError {
  ok: false;
  error: string;
}

export type DeleteResult = DeleteSuccess | DeleteError;

/**
 * Delete a Video, its Transcriptions (via FK cascade) and its folder on disk.
 *
 * The cleanup directory is derived from the Video's stored audioFilePath
 * (its parent directory) rather than the current mediaDir, so a folder
 * change after download does not leave orphan files.
 */
export async function deleteVideo(videoId: number, db: Db): Promise<DeleteResult> {
  const deleted = await db
    .delete(schema.videos)
    .where(and(eq(schema.videos.id, videoId), ne(schema.videos.status, "downloading")))
    .returning({ audioFilePath: schema.videos.audioFilePath });

  if (!deleted[0]) {
    const video = await getVideoById(videoId, db);
    if (!video) return { ok: false, error: "Video not found." };
    return {
      ok: false,
      error: "Video cannot be deleted while its audio is downloading.",
    };
  }

  const videoDir = deleted[0].audioFilePath ? dirname(deleted[0].audioFilePath) : null;
  if (videoDir && existsSync(videoDir)) {
    rmSync(videoDir, { recursive: true, force: true });
  }

  return { ok: true };
}

/**
 * Claim and re-download audio for a downloaded or errored Video.
 */
export async function redownloadVideoAudio(
  videoId: number,
  runner: ProcessRunner,
  db: Db,
  mediaDir: string,
): Promise<DownloadResult> {
  const claim = await claimVideoAudioDownload(videoId, "redownload", db);
  if (!claim.ok) return claim;
  return runClaimedVideoAudioDownload(claim.video, runner, db, mediaDir);
}

/** yt-dlp `--referer` flag for the page that embeds the video, or nothing. */
function refererArgs(refererUrl: string | null): string[] {
  return refererUrl ? ["--referer", refererUrl] : [];
}

/**
 * Minimal URL normalization: lowercase protocol + host, strip trailing slash.
 */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, "")}${u.search}${u.hash}`;
  } catch {
    return raw;
  }
}
