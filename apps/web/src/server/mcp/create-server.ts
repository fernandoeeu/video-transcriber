import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as schema from "@video-transcriber/db/schema";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

import { checkDependencies } from "../../core/dependencies";
import type { ProcessRunner } from "../../core/process-runner";
import { clearDownloadFolder, getDownloadFolder, setDownloadFolder } from "../../core/settings";
import {
  enqueueTranscription,
  getLatestTranscription,
  getTranscriptionById,
  getTranscriptionWithQueue,
  listTranscriptions,
  segmentsToPlainText,
  segmentsToSrt,
  type TranscriptionQueue,
} from "../../core/transcription";
import {
  beginVideoAudioDownload,
  deleteVideo,
  fetchVideoMetadata,
  getVideoById,
  listVideos,
} from "../../core/video";

type Db = LibSQLDatabase<typeof schema>;

export interface VideoTranscriberMcpDeps {
  db: Db;
  runner: ProcessRunner;
  getQueue: () => Promise<TranscriptionQueue>;
  getMediaDir: () => Promise<string>;
  defaultMediaDir: string;
  projectRoot: string;
}

const videoIdInput = {
  videoId: z.number().int().describe("Video id"),
};

const transcriptionIdInput = {
  transcriptionId: z.number().int().describe("Transcription id"),
};

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export function createVideoTranscriberMcpServer(deps: VideoTranscriberMcpDeps): McpServer {
  const { db, runner, getQueue, getMediaDir, defaultMediaDir, projectRoot } = deps;

  const server = new McpServer(
    { name: "video-transcriber", version: "1.0.0" },
    {
      instructions:
        "Local video download and transcription. Preview a URL, download audio with yt-dlp, and transcribe with Whisper.",
    },
  );

  server.registerTool(
    "preview_video",
    {
      description:
        "Fetch metadata for a video URL with yt-dlp and store a Video. Duplicate URLs reuse the existing Video. For embed-only Vimeo URLs, pass refererUrl as the embedding page.",
      inputSchema: {
        url: z.string().min(1).describe("Video URL"),
        refererUrl: z
          .string()
          .optional()
          .describe("URL of the page that embeds the video (Vimeo embed-only)"),
      },
    },
    async ({ url, refererUrl }) =>
      jsonResult(await fetchVideoMetadata(url, runner, db, { refererUrl })),
  );

  server.registerTool("list_videos", { description: "List all Videos, oldest first." }, async () =>
    jsonResult(await listVideos(db)),
  );

  server.registerTool(
    "get_video",
    {
      description: "Get a Video by id, including download status and audio path.",
      inputSchema: videoIdInput,
    },
    async ({ videoId }) => jsonResult(await getVideoById(videoId, db)),
  );

  server.registerTool(
    "download_video",
    {
      description:
        "Start downloading audio for a Video that is ready to download. Returns immediately; poll get_video for progress.",
      inputSchema: videoIdInput,
    },
    async ({ videoId }) => {
      const mediaDir = await getMediaDir();
      return jsonResult(await beginVideoAudioDownload(videoId, "download", runner, db, mediaDir));
    },
  );

  server.registerTool(
    "redownload_video",
    {
      description:
        "Re-download audio for a downloaded or errored Video. Returns immediately; poll get_video for progress.",
      inputSchema: videoIdInput,
    },
    async ({ videoId }) => {
      const mediaDir = await getMediaDir();
      return jsonResult(await beginVideoAudioDownload(videoId, "redownload", runner, db, mediaDir));
    },
  );

  server.registerTool(
    "delete_video",
    {
      description: "Delete a Video, its Transcriptions, and its audio folder on disk.",
      inputSchema: videoIdInput,
    },
    async ({ videoId }) => jsonResult(await deleteVideo(videoId, db)),
  );

  server.registerTool(
    "transcribe_video",
    {
      description:
        "Enqueue a Whisper transcription for a downloaded Video. Returns immediately with the queued Transcription.",
      inputSchema: videoIdInput,
    },
    async ({ videoId }) => jsonResult(await enqueueTranscription(videoId, await getQueue(), db)),
  );

  server.registerTool(
    "get_transcription",
    {
      description: "Get a Transcription by id, including queue position when it is queued.",
      inputSchema: transcriptionIdInput,
    },
    async ({ transcriptionId }) =>
      jsonResult(await getTranscriptionWithQueue(transcriptionId, await getQueue(), db)),
  );

  server.registerTool(
    "list_transcriptions",
    {
      description: "List all Transcriptions for a Video, newest first.",
      inputSchema: videoIdInput,
    },
    async ({ videoId }) => {
      await getQueue();
      return jsonResult(await listTranscriptions(videoId, db));
    },
  );

  server.registerTool(
    "get_latest_transcription",
    {
      description: "Get the most recently inserted Transcription for a Video.",
      inputSchema: videoIdInput,
    },
    async ({ videoId }) => {
      await getQueue();
      return jsonResult(await getLatestTranscription(videoId, db));
    },
  );

  server.registerTool(
    "export_transcription_txt",
    {
      description: "Export a completed Transcription as plain text.",
      inputSchema: transcriptionIdInput,
    },
    async ({ transcriptionId }) => {
      await getQueue();
      const transcription = await getTranscriptionById(transcriptionId, db);
      if (!transcription || transcription.status !== "completed" || !transcription.segments) {
        return jsonResult({
          ok: false as const,
          error: "No completed Transcription with segments.",
        });
      }
      return jsonResult({
        ok: true as const,
        content: segmentsToPlainText(transcription.segments),
      });
    },
  );

  server.registerTool(
    "export_transcription_srt",
    {
      description: "Export a completed Transcription as SubRip (.srt).",
      inputSchema: transcriptionIdInput,
    },
    async ({ transcriptionId }) => {
      await getQueue();
      const transcription = await getTranscriptionById(transcriptionId, db);
      if (!transcription || transcription.status !== "completed" || !transcription.segments) {
        return jsonResult({
          ok: false as const,
          error: "No completed Transcription with segments.",
        });
      }
      return jsonResult({ ok: true as const, content: segmentsToSrt(transcription.segments) });
    },
  );

  server.registerTool(
    "get_dependencies",
    {
      description:
        "Check that yt-dlp, ffmpeg, whisper-cli, and the Whisper model file are available for download and transcription.",
    },
    async () => jsonResult(await checkDependencies(runner, projectRoot)),
  );

  server.registerTool(
    "get_settings",
    { description: "Get the download folder used for extracted audio." },
    async () => {
      const downloadFolder = await getDownloadFolder(db, defaultMediaDir);
      return jsonResult({ downloadFolder, defaultDownloadFolder: defaultMediaDir });
    },
  );

  server.registerTool(
    "update_download_folder",
    {
      description: "Set the folder where downloaded audio is stored. Existing files are not moved.",
      inputSchema: {
        folder: z.string().min(1).describe("Absolute path for downloaded audio"),
      },
    },
    async ({ folder }) => {
      await setDownloadFolder(db, folder);
      const downloadFolder = await getDownloadFolder(db, defaultMediaDir);
      return jsonResult({ downloadFolder, defaultDownloadFolder: defaultMediaDir });
    },
  );

  server.registerTool(
    "reset_download_folder",
    { description: "Clear the stored download folder so new downloads use the default." },
    async () => {
      await clearDownloadFolder(db);
      return jsonResult({
        downloadFolder: defaultMediaDir,
        defaultDownloadFolder: defaultMediaDir,
      });
    },
  );

  return server;
}
