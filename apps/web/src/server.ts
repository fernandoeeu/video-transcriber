import serverEntry from "@tanstack/react-start/server-entry";

import { startTranscriptionQueue } from "./server/transcription-queue.server";

void startTranscriptionQueue();

export default serverEntry;
