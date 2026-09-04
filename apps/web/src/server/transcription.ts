import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  enqueueTranscription,
  getLatestTranscription,
  getTranscriptionById,
  getTranscriptionWithQueue,
  listTranscriptions,
  segmentsToPlainText,
  segmentsToSrt,
} from "../core/transcription";
import { db } from "./db";
import { startTranscriptionQueue } from "./transcription-queue.server";

export const transcribeVideo = createServerFn({ method: "POST" })
  .validator(z.object({ videoId: z.number() }))
  .handler(async ({ data }) => {
    return enqueueTranscription(data.videoId, await startTranscriptionQueue(), db);
  });

export const getTranscription = createServerFn({ method: "GET" })
  .validator(z.object({ transcriptionId: z.number() }))
  .handler(async ({ data }) => {
    return getTranscriptionWithQueue(data.transcriptionId, await startTranscriptionQueue(), db);
  });

export const getVideoTranscriptions = createServerFn({ method: "GET" })
  .validator(z.object({ videoId: z.number() }))
  .handler(async ({ data }) => {
    await startTranscriptionQueue();
    return listTranscriptions(data.videoId, db);
  });

export const getVideoLatestTranscription = createServerFn({ method: "GET" })
  .validator(z.object({ videoId: z.number() }))
  .handler(async ({ data }) => {
    await startTranscriptionQueue();
    return getLatestTranscription(data.videoId, db);
  });

export const exportTranscriptionTxt = createServerFn({ method: "GET" })
  .validator(z.object({ transcriptionId: z.number() }))
  .handler(async ({ data }) => {
    await startTranscriptionQueue();
    const t = await getTranscriptionById(data.transcriptionId, db);
    if (!t || t.status !== "completed" || !t.segments) {
      return { ok: false as const, error: "No completed Transcription with segments." };
    }
    return { ok: true as const, content: segmentsToPlainText(t.segments) };
  });

export const exportTranscriptionSrt = createServerFn({ method: "GET" })
  .validator(z.object({ transcriptionId: z.number() }))
  .handler(async ({ data }) => {
    await startTranscriptionQueue();
    const t = await getTranscriptionById(data.transcriptionId, db);
    if (!t || t.status !== "completed" || !t.segments) {
      return { ok: false as const, error: "No completed Transcription with segments." };
    }
    return { ok: true as const, content: segmentsToSrt(t.segments) };
  });
