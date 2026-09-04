import "@tanstack/react-start/server-only";

import { join } from "node:path";

import { createProcessRunner } from "../core/process-runner";
import { createTranscriptionQueueInitializer, processTranscription } from "../core/transcription";
import { db } from "./db";

const runner = createProcessRunner();
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const MODEL_PATH = join(PROJECT_ROOT, "data", "models", "ggml-large-v3-turbo.bin");

const initializeQueue = createTranscriptionQueueInitializer(
  (transcriptionId, videoId) =>
    processTranscription(transcriptionId, videoId, runner, db, MODEL_PATH),
  db,
);

let observedAttempt: ReturnType<typeof initializeQueue> | undefined;

/**
 * Start or join the current queue initialization attempt. A failed attempt is logged once and the
 * next call starts one shared retry through createTranscriptionQueueInitializer.
 */
export function startTranscriptionQueue() {
  const attempt = initializeQueue();

  if (attempt !== observedAttempt) {
    observedAttempt = attempt;
    void attempt.catch((error: unknown) => {
      console.error(
        "Transcription queue startup failed; the next server request will retry.",
        error,
      );
    });
  }

  return attempt;
}
