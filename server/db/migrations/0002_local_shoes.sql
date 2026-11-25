ALTER TABLE `gear` ADD `local` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `gear` ADD `in_use_from` text;--> statement-breakpoint
ALTER TABLE `gear` ADD `retired_from` text;