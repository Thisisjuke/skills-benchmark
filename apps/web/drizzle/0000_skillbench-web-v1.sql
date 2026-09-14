CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`content_hash` text NOT NULL,
	`size_bytes` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_run_path_unique` ON `artifacts` (`run_id`,`path`);--> statement-breakpoint
CREATE TABLE `job_events` (
	`job_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`job_id`, `sequence`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_events_job_sequence_index` ON `job_events` (`job_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`command` text NOT NULL,
	`status` text NOT NULL,
	`request_json` text NOT NULL,
	`result_json` text,
	`error_json` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	CONSTRAINT "jobs_command_check" CHECK("jobs"."command" IN ('inspect', 'eval', 'compare', 'merge')),
	CONSTRAINT "jobs_status_check" CHECK("jobs"."status" IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'))
);
--> statement-breakpoint
CREATE INDEX `jobs_created_at_index` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_status_index` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`path` text NOT NULL,
	`media_type` text NOT NULL,
	`content_hash` text NOT NULL,
	`size_bytes` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_run_path_unique` ON `reports` (`run_id`,`path`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`command` text NOT NULL,
	`result_json` text NOT NULL,
	`bundle_path` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_job_id_unique` ON `runs` (`job_id`);--> statement-breakpoint
CREATE INDEX `runs_created_at_index` ON `runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`role` text NOT NULL,
	`origin` text NOT NULL,
	`original_input` text NOT NULL,
	`root_path` text NOT NULL,
	`fingerprint` text NOT NULL,
	`manifest_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_snapshots_fingerprint_index` ON `source_snapshots` (`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_run_role_unique` ON `source_snapshots` (`run_id`,`role`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`input` text NOT NULL,
	`skill_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "sources_kind_check" CHECK("sources"."kind" IN ('local', 'github'))
);
--> statement-breakpoint
CREATE INDEX `sources_updated_at_index` ON `sources` (`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sources_input_skill_path_unique` ON `sources` (`input`,`skill_path`);