import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { defaultMediaDir, getDownloadFolder, setDownloadFolder } from "../core/settings";
import { db } from "./db";

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const DEFAULT_MEDIA_DIR = defaultMediaDir(PROJECT_ROOT);

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  const downloadFolder = await getDownloadFolder(db, DEFAULT_MEDIA_DIR);
  return { downloadFolder, defaultDownloadFolder: DEFAULT_MEDIA_DIR };
});

export const updateDownloadFolder = createServerFn({ method: "POST" })
  .validator(z.object({ folder: z.string().min(1) }))
  .handler(async ({ data }) => {
    await setDownloadFolder(db, data.folder);
    const downloadFolder = await getDownloadFolder(db, DEFAULT_MEDIA_DIR);
    return { downloadFolder, defaultDownloadFolder: DEFAULT_MEDIA_DIR };
  });

export const resetDownloadFolder = createServerFn({ method: "POST" }).handler(async () => {
  // Remove the setting so it falls back to the default
  const { eq } = await import("drizzle-orm");
  const { settings } = await import("@video-transcriber/db/schema");
  await db.delete(settings).where(eq(settings.key, "download_folder"));
  return { downloadFolder: DEFAULT_MEDIA_DIR, defaultDownloadFolder: DEFAULT_MEDIA_DIR };
});
