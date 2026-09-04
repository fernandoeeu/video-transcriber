import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const videos = sqliteTable("videos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  originUrl: text("origin_url").notNull().unique(),
  /** Page that embeds the video. Sent as the HTTP Referer to yt-dlp (Vimeo embed-only videos). */
  refererUrl: text("referer_url"),
  title: text("title").notNull(),
  duration: integer("duration"),
  channel: text("channel"),
  status: text("status", {
    enum: ["fetching_metadata", "ready_to_download", "downloading", "downloaded", "error"],
  })
    .notNull()
    .default("fetching_metadata"),
  progress: integer("progress"),
  audioFilePath: text("audio_file_path"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const transcriptions = sqliteTable(
  "transcriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    videoId: integer("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "converting", "transcribing", "completed", "error"],
    })
      .notNull()
      .default("queued"),
    progress: integer("progress"),
    engine: text("engine"),
    model: text("model"),
    language: text("language"),
    /** JSON array of { start: number, end: number, text: string } */
    segments: text("segments"),
    sourceAudioPath: text("source_audio_path"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("transcriptions_one_active_per_video")
      .on(table.videoId)
      .where(sql`${table.status} in ('queued', 'converting', 'transcribing')`),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
