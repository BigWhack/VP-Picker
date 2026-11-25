CREATE TABLE `baselines` (
	`date` text NOT NULL,
	`metric` text NOT NULL,
	`median` real NOT NULL,
	`iqr` real NOT NULL,
	`n` integer NOT NULL,
	PRIMARY KEY(`date`, `metric`)
);
--> statement-breakpoint
CREATE TABLE `daily` (
	`date` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gear` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`distance_m` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`path` text NOT NULL,
	`hash` text NOT NULL,
	`received_at` text NOT NULL,
	`status` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imports_hash_unique` ON `imports` (`hash`);--> statement-breakpoint
CREATE TABLE `insights` (
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`text` text NOT NULL,
	`evidence_json` text,
	PRIMARY KEY(`date`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `load` (
	`date` text PRIMARY KEY NOT NULL,
	`load` real NOT NULL,
	`atl` real NOT NULL,
	`ctl` real NOT NULL,
	`tsb` real NOT NULL,
	`acwr` real
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`provider` text PRIMARY KEY NOT NULL,
	`access` text NOT NULL,
	`refresh` text NOT NULL,
	`expires_at` integer NOT NULL,
	`athlete_json` text
);
--> statement-breakpoint
CREATE TABLE `records` (
	`kind` text NOT NULL,
	`distance_m` real NOT NULL,
	`workout_id` text NOT NULL,
	`time_s` real NOT NULL,
	`date` text NOT NULL,
	PRIMARY KEY(`kind`, `distance_m`, `workout_id`)
);
--> statement-breakpoint
CREATE TABLE `record_streams` (
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`json_gz` blob NOT NULL,
	PRIMARY KEY(`source`, `source_id`)
);
--> statement-breakpoint
CREATE TABLE `samples` (
	`metric` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`metric`, `start`, `end`, `source`)
);
--> statement-breakpoint
CREATE TABLE `scores` (
	`date` text PRIMARY KEY NOT NULL,
	`recovery` real,
	`recovery_json` text,
	`sleep_score` real,
	`sleep_json` text,
	`headline` text,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sleep_segments` (
	`start` text NOT NULL,
	`end` text NOT NULL,
	`stage` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`start`, `stage`, `source`)
);
--> statement-breakpoint
CREATE TABLE `strava_queue` (
	`activity_id` text PRIMARY KEY NOT NULL,
	`step` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`added_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`counts_json` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `workout_analysis` (
	`workout_id` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workout_extras` (
	`strava_id` text PRIMARY KEY NOT NULL,
	`laps_json` text,
	`splits_json` text,
	`best_efforts_json` text,
	`segments_json` text
);
--> statement-breakpoint
CREATE TABLE `workout_records` (
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`sport` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`tz_offset_min` integer DEFAULT 0 NOT NULL,
	`duration_s` real NOT NULL,
	`moving_s` real,
	`distance_m` real,
	`elev_gain_m` real,
	`energy_kcal` real,
	`avg_hr` real,
	`max_hr` real,
	`name` text,
	`gear_id` text,
	`polyline` text,
	`raw_json` text,
	PRIMARY KEY(`source`, `source_id`)
);
--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`apple_id` text,
	`strava_id` text,
	`sport` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`tz_offset_min` integer DEFAULT 0 NOT NULL,
	`duration_s` real NOT NULL,
	`moving_s` real,
	`distance_m` real,
	`elev_gain_m` real,
	`energy_kcal` real,
	`avg_hr` real,
	`max_hr` real,
	`name` text,
	`gear_id` text,
	`polyline` text,
	`sources` text NOT NULL,
	`weather_json` text
);
