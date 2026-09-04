CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `transcriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer,
	`engine` text,
	`model` text,
	`language` text,
	`segments` text,
	`source_audio_path` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin_url` text NOT NULL,
	`title` text NOT NULL,
	`duration` integer,
	`channel` text,
	`status` text DEFAULT 'fetching_metadata' NOT NULL,
	`progress` integer,
	`audio_file_path` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `videos_origin_url_unique` ON `videos` (`origin_url`);