import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { createProcessRunner } from "../core/process-runner";
import { defaultMediaDir, getDownloadFolder } from "../core/settings";
import {
  claimVideoAudioDownload,
  deleteVideo as deleteVideoCore,
  fetchVideoMetadata,
  getVideoById,
  listVideos,
  runClaimedVideoAudioDownload,
  type DownloadRequest,
} from "../core/video";
import { db } from "./db";

const runner = createProcessRunner();

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const DEFAULT_MEDIA_DIR = defaultMediaDir(PROJECT_ROOT);

export const previewVideo = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().min(1), refererUrl: z.string().optional() }))
  .handler(async ({ data }) => {
    return fetchVideoMetadata(data.url, runner, db, { refererUrl: data.refererUrl });
  });

export const getVideos = createServerFn({ method: "GET" }).handler(async () => {
  return listVideos(db);
});

export const getVideo = createServerFn({ method: "GET" })
  .validator(z.object({ videoId: z.number() }))
  .handler(async ({ data }) => {
    return getVideoById(data.videoId, db);
  });

async function startVideoDownload(videoId: number, request: DownloadRequest) {
  const mediaDir = await getDownloadFolder(db, DEFAULT_MEDIA_DIR);
  const claim = await claimVideoAudioDownload(videoId, request, db);

  if (!claim.ok) {
    return getVideoById(videoId, db);
  }

  void runClaimedVideoAudioDownload(claim.video, runner, db, mediaDir).catch(() => {
    // The execution helper persists failures before returning.
  });

  return claim.video;
}

export const downloadVideo = createServerFn({ method: "POST" })
  .validator(z.object({ videoId: z.number() }))
  .handler(async ({ data }) => startVideoDownload(data.videoId, "download"));

export const redownloadVideo = createServerFn({ method: "POST" })
  .validator(z.object({ videoId: z.number() }))
  .handler(async ({ data }) => startVideoDownload(data.videoId, "redownload"));

export const removeVideo = createServerFn({ method: "POST" })
  .validator(z.object({ videoId: z.number() }))
  .handler(async ({ data }) => {
    return deleteVideoCore(data.videoId, db);
  });
