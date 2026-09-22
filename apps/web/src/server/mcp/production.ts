import { createProcessRunner } from "../../core/process-runner";
import { defaultMediaDir, getDownloadFolder } from "../../core/settings";
import { db } from "../db";
import { startTranscriptionQueue } from "../transcription-queue.server";
import { createVideoTranscriberMcpServer } from "./create-server";

const runner = createProcessRunner();
const PROJECT_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const DEFAULT_MEDIA_DIR = defaultMediaDir(PROJECT_ROOT);

export function createProductionMcpServer() {
  return createVideoTranscriberMcpServer({
    db,
    runner,
    getQueue: startTranscriptionQueue,
    getMediaDir: () => getDownloadFolder(db, DEFAULT_MEDIA_DIR),
    defaultMediaDir: DEFAULT_MEDIA_DIR,
    projectRoot: PROJECT_ROOT,
  });
}
