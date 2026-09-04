UPDATE `transcriptions`
SET
  `status` = 'error',
  `progress` = NULL,
  `error_message` = 'Superseded by another active Transcription.'
WHERE
  `status` IN ('queued', 'converting', 'transcribing')
  AND EXISTS (
    SELECT 1
    FROM `transcriptions` AS `newer`
    WHERE
      `newer`.`video_id` = `transcriptions`.`video_id`
      AND `newer`.`status` IN ('queued', 'converting', 'transcribing')
      AND `newer`.`id` > `transcriptions`.`id`
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `transcriptions_one_active_per_video` ON `transcriptions` (`video_id`) WHERE "transcriptions"."status" in ('queued', 'converting', 'transcribing');
