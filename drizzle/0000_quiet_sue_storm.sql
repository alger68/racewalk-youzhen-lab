CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`athlete` text NOT NULL,
	`session_date` text NOT NULL,
	`view` text NOT NULL,
	`speed` text NOT NULL,
	`pace` real,
	`file_name` text NOT NULL,
	`result_key` text NOT NULL,
	`summary` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`video_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_owner_date` ON `sessions` (`owner_id`,`session_date`);