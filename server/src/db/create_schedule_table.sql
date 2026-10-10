USE `AnsibleForms`;
CREATE TABLE `schedule` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `one_time_run` TINYINT(4) DEFAULT 0,
  `cron` VARCHAR(50) DEFAULT NULL,
  `run_at` DATETIME DEFAULT NULL,
  `form` VARCHAR(255) DEFAULT NULL,
  `status` VARCHAR(50) DEFAULT NULL,
  `last_run` DATETIME DEFAULT NULL,
  `state` VARCHAR(50) DEFAULT NULL,
  -- who launches it (state='running') and since when (models/schedule.model.js launch)
  `claim_node` varchar(250) DEFAULT NULL,
  `claim_since` datetime DEFAULT NULL,
  `queue_id` INT DEFAULT 0,  
  `extra_vars` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `output` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  -- the user a planned job ("Run later") runs as ; NULL for an admin-level schedule
  `owner` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  -- a planned job's raw field values, for the launch validation when it fires
  `raw_form_data` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  UNIQUE KEY `uk_schedule_natural_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
