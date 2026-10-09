-- disable foreign key checks to avoid errors when creating tables
SET FOREIGN_KEY_CHECKS=0;
-- create the database if it does not exist
CREATE DATABASE /*!32312 IF NOT EXISTS*/`AnsibleForms` /*!40100 DEFAULT CHARACTER SET utf8 */;
-- use the database
USE `AnsibleForms`;
-- create groups table
DROP TABLE IF EXISTS `groups`;
CREATE TABLE `groups`(
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_AnsibleForms_groups_natural_key` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8;
-- create users table
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users`(
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `group_id` int(11) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_AnsibleForms_users_natural_key` (`username`),
    KEY `FK_users_group` (`group_id`),
    CONSTRAINT `FK_users_group` FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8;
-- create tokens table
DROP TABLE IF EXISTS `tokens`;
CREATE TABLE `tokens` (
  `username` varchar(250) NOT NULL,
  `username_type` varchar(10) NOT NULL,
  `refresh_token` text DEFAULT NULL,
  `timestamp` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
-- create credentials table
DROP TABLE IF EXISTS `credentials`;
CREATE TABLE `credentials` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(250) NOT NULL,
  `user` varchar(250) DEFAULT NULL,
  `password` text DEFAULT NULL,
  `host` varchar(250) DEFAULT NULL,
  `port` int(11) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `secure` tinyint(4) DEFAULT NULL,
  `db_type` varchar(10) DEFAULT NULL,
  `db_name` varchar(255) DEFAULT NULL,  
  `is_database` tinyint(4) DEFAULT 1,
  `vault_path` varchar(500) DEFAULT NULL,
  `managed` tinyint(4) DEFAULT 0,
  -- the secret store a credential reads its user and password from, and where in it
  `secret_store` varchar(250) DEFAULT NULL,
  `secret_ref` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_AnsibleForms_credentials_natural_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
-- create secret_stores table : HashiCorp Vault, CyberArk, ... (one row per store)
-- keep in sync with create_secret_stores_table.sql, which the upgrade patch uses
DROP TABLE IF EXISTS `secret_stores`;
CREATE TABLE `secret_stores` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(250) NOT NULL,
  `type` varchar(20) NOT NULL,
  `description` text DEFAULT NULL,
  `url` varchar(500) NOT NULL,
  `token` text DEFAULT NULL,
  `namespace` varchar(250) DEFAULT NULL,
  `kv_version` tinyint(4) DEFAULT 2,
  `default_mount` varchar(250) DEFAULT NULL,
  `app_id` varchar(250) DEFAULT NULL,
  `client_cert` text DEFAULT NULL,
  `client_key` text DEFAULT NULL,
  `ignore_certs` tinyint(4) DEFAULT 0,
  `ca_bundle` text DEFAULT NULL,
  `cache_ttl_seconds` int(11) DEFAULT 60,
  `extra` text DEFAULT NULL,
  `managed` tinyint(4) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_AnsibleForms_secret_stores_natural_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- keep in sync with create_runners_table.sql, which the upgrade patch uses
DROP TABLE IF EXISTS `runners`;
CREATE TABLE `runners` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(250) NOT NULL,
  `type` varchar(20) NOT NULL,
  `description` text DEFAULT NULL,
  `uri` varchar(500) NOT NULL,
  `token` text DEFAULT NULL,
  `username` varchar(250) DEFAULT NULL,
  `password` text DEFAULT NULL,
  `use_credentials` tinyint(4) DEFAULT 0,
  `ignore_certs` tinyint(4) DEFAULT 0,
  `ca_bundle` text DEFAULT NULL,
  `is_default` tinyint(4) DEFAULT 0,
  `flavour` varchar(20) DEFAULT NULL,
  `managed` tinyint(4) DEFAULT 0,
  `node_id` varchar(250) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_AnsibleForms_runners_natural_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
-- create ldap table
DROP TABLE IF EXISTS `ldap`;
CREATE TABLE `ldap` (
  `server` varchar(250) DEFAULT NULL,
  `port` int(11) DEFAULT NULL,
  `ignore_certs` tinyint(4) DEFAULT NULL,
  `enable_tls` tinyint(4) DEFAULT NULL,
  `cert` text DEFAULT NULL,
  `ca_bundle` text DEFAULT NULL,
  `bind_user_dn` varchar(250) DEFAULT NULL,
  `bind_user_pw` text DEFAULT NULL,
  `search_base` varchar(250) DEFAULT NULL,
  `username_attribute` varchar(250) DEFAULT NULL,
  `groups_search_base` varchar(250) DEFAULT NULL,
  `groups_attribute` varchar(250) DEFAULT NULL,
  `group_class` varchar(250) DEFAULT NULL,
  `group_member_attribute` varchar(250) DEFAULT NULL,
  `group_member_user_attribute` varchar(250) DEFAULT NULL,
  `mail_attribute` varchar(250) DEFAULT NULL,
  `groupfilter` varchar(250) DEFAULT NULL,
  `enable` tinyint(4) DEFAULT NULL,
  `managed` tinyint(4) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
-- create chat_settings table : the model provider of the chat assistant (one row)
DROP TABLE IF EXISTS `chat_settings`;
CREATE TABLE `chat_settings` (
  `provider` varchar(20) DEFAULT NULL,
  `api_key` text DEFAULT NULL,
  `base_url` varchar(500) DEFAULT NULL,
  `model` varchar(200) DEFAULT NULL,
  `max_turns` int(11) DEFAULT 20,
  `max_tool_rounds` int(11) DEFAULT 6,
  `timeout_seconds` int(11) DEFAULT 60,
  `allow_job_status` tinyint(4) DEFAULT 1,
  `auth_type` varchar(20) DEFAULT NULL,
  `api_version` varchar(50) DEFAULT NULL,
  `request_user` varchar(100) DEFAULT NULL,
  `extra_headers` text DEFAULT NULL,
  `ignore_certs` tinyint(4) DEFAULT 0,
  `managed` tinyint(4) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
-- create job_output and jobs tables
DROP TABLE IF EXISTS `job_output`;
DROP TABLE IF EXISTS `jobs`;
CREATE TABLE `jobs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `form` varchar(250) DEFAULT NULL,
  `target` varchar(250) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL,
  `start` datetime NOT NULL DEFAULT current_timestamp(),
  `end` datetime DEFAULT NULL,
  `user` varchar(250) DEFAULT NULL,
  `user_type` varchar(10) DEFAULT NULL,
  `job_type` varchar(20) DEFAULT NULL,
  `abort_requested` tinyint(4) DEFAULT NULL,
  `extravars` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `credentials` mediumtext DEFAULT NULL,
  `notifications` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approval` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `step` varchar(250) DEFAULT NULL,
  `parent_id` int(11) DEFAULT NULL,
  `awx_id` int(11) DEFAULT NULL,
  `awx_artifacts` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `awx_workflow` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  -- added by a patch on an existing install ; keep both paths in sync (schema.model.js)
  `raw_form_data` longtext DEFAULT NULL,
  `pid` int(11) DEFAULT NULL,
  `host` varchar(255) DEFAULT NULL,
  `runner` varchar(250) DEFAULT NULL,
  `job_log` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tracker` varchar(250) DEFAULT NULL,
  PRIMARY KEY (`id`),
  -- the retention sweep selects on (parent_id, status, end) ; without this it full
  -- scans the largest table in the schema on every batch. Keep in sync with the
  -- patch in schema.model.js that adds it to an existing install.
  KEY `idx_jobs_retention` (`parent_id`, `status`, `end`)
) ENGINE=InnoDB AUTO_INCREMENT=47 DEFAULT CHARSET=utf8;
CREATE TABLE `job_output` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `output` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timestamp` datetime NOT NULL DEFAULT current_timestamp(),
  `output_type` varchar(10) NOT NULL,
  `job_id` int(11) NOT NULL,
  `order` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `FK_job_output_jobs` (`job_id`),
  CONSTRAINT `FK_job_output_jobs` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1650 DEFAULT CHARSET=utf8;
-- create settings table
DROP TABLE IF EXISTS `settings`;
CREATE TABLE `settings` (
  `mail_server` varchar(250) DEFAULT NULL,
  `mail_port` int(11) DEFAULT NULL,
  `mail_secure` tinyint(4) DEFAULT NULL,
  `mail_username` varchar(250) DEFAULT NULL,
  `mail_password` text DEFAULT NULL,
  `mail_from` varchar(250) DEFAULT NULL,
  `url` varchar(250) DEFAULT NULL,
  `forms_yaml` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `logo` longtext DEFAULT NULL,
  `config_source` varchar(20) DEFAULT NULL,
  `default_language` varchar(5) DEFAULT NULL,
  `default_theme` varchar(10) DEFAULT NULL,
  `default_theme_color` varchar(7) DEFAULT NULL,
  `vault_env_imported_at` datetime DEFAULT NULL,
  `managed` tinyint(4) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
-- oauth2 providers table
USE `AnsibleForms`;
DROP TABLE IF EXISTS `oauth2_providers`;
CREATE TABLE `oauth2_providers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `provider` VARCHAR(50) NOT NULL, -- e.g., 'azuread', 'oidc', 'google', 'github'
  `name` VARCHAR(100) DEFAULT NULL, -- required name for the provider
  `description` VARCHAR(250) DEFAULT NULL, -- optional description for the provider
  `issuer` TEXT DEFAULT NULL,
  -- added by a patch on an existing install ; keep both paths in sync (schema.model.js)
  `tenant_id` TEXT DEFAULT NULL,
  `client_id` TEXT DEFAULT NULL,
  `client_secret` TEXT DEFAULT NULL,
  `enable` TINYINT(4) DEFAULT NULL,
  `groupfilter` VARCHAR(250) DEFAULT NULL,
  `redirect_uri` TEXT DEFAULT NULL,
  `scope` TEXT DEFAULT NULL,
  `auth_url` TEXT DEFAULT NULL,
  `token_url` TEXT DEFAULT NULL,
  `userinfo_url` TEXT DEFAULT NULL,
  `extra` JSON DEFAULT NULL, -- for any additional provider-specific config
  `managed` tinyint(4) DEFAULT 0,
  UNIQUE KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
-- create repositories table
DROP TABLE IF EXISTS `repositories`;
CREATE TABLE `repositories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(250) NOT NULL,
  `user` varchar(250) DEFAULT NULL,
  `password` text DEFAULT NULL,
  `uri` varchar(250) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `use_for_forms` tinyint(4) DEFAULT NULL,
  `use_for_playbooks` tinyint(4) DEFAULT NULL,
  -- added by a patch on an existing install ; keep both paths in sync (schema.model.js)
  `branch` varchar(250) DEFAULT NULL,
  `use_for_config` tinyint(4) DEFAULT 0,
  `use_for_vars_files` tinyint(4) DEFAULT 0,
  `cron` varchar(50) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  -- who holds the status='running' claim and since when (models/repository.model.js claim)
  `claim_node` varchar(250) DEFAULT NULL,
  `claim_since` datetime DEFAULT NULL,
  `output` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `head` varchar(50) DEFAULT NULL,    
  `rebase_on_start` tinyint(4) DEFAULT NULL,
  `managed` tinyint(4) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_AnsibleForms_repositories_natural_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
-- create schedule table
DROP TABLE IF EXISTS `schedule`;
CREATE TABLE `schedule` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `cron` VARCHAR(50) DEFAULT NULL,
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
  -- added by a patch on an existing install ; keep both paths in sync (schema.model.js)
  `one_time_run` tinyint(4) DEFAULT 0,
  `run_at` datetime DEFAULT NULL,
  -- the user a planned job ("Run later") runs as ; NULL for an admin-level schedule
  `owner` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  UNIQUE KEY `uk_schedule_natural_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- create audit table (append only : there is no update or delete path for a row,
-- only the retention sweep. Keep in sync with src/db/create_audit_table.sql, which
-- is what the patch for existing installs runs)
DROP TABLE IF EXISTS `audit`;
CREATE TABLE `audit` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actor` VARCHAR(255) DEFAULT NULL,
  `actor_type` VARCHAR(20) DEFAULT NULL,
  `ip` VARCHAR(45) DEFAULT NULL,
  `action` VARCHAR(64) NOT NULL,
  `target_type` VARCHAR(64) DEFAULT NULL,
  `target` VARCHAR(255) DEFAULT NULL,
  `outcome` VARCHAR(16) NOT NULL,
  `detail` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_actor` (`actor`, `created_at`),
  KEY `idx_audit_action` (`action`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- default values are created at startup

-- stored jobs
-- This table used to be created only by a patch, which meant this file left its rows
-- behind while dropping everything they refer to (forms, users) - and a fresh install
-- with a grant that allows CREATE but not ALTER never got the table at all.
DROP TABLE IF EXISTS `stored_jobs`;
CREATE TABLE `stored_jobs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `form_name` VARCHAR(255) NOT NULL,
  `username` VARCHAR(255) NOT NULL,
  `form_data` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME DEFAULT NULL,
  UNIQUE KEY `uk_user_form_name` (`username`, `form_name`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- the processes on this database (lib/nodes.js), what changed between them
-- (lib/epochs.js) and the designer lock (models/lock.model.js). Keep in sync with
-- create_nodes_table.sql, create_cache_epochs_table.sql and create_designer_lock_table.sql.
DROP TABLE IF EXISTS `nodes`;
CREATE TABLE `nodes` (
  `id` varchar(250) NOT NULL,
  `role` varchar(20) DEFAULT NULL,
  `version` varchar(50) DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `last_seen` datetime DEFAULT NULL,
  `is_worker` tinyint(4) DEFAULT 0,
  `info` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

DROP TABLE IF EXISTS `cache_epochs`;
CREATE TABLE `cache_epochs` (
  `name` varchar(64) NOT NULL,
  `version` bigint(20) NOT NULL DEFAULT 0,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

DROP TABLE IF EXISTS `designer_lock`;
CREATE TABLE `designer_lock` (
  `id` tinyint(4) NOT NULL,
  `data` mediumtext DEFAULT NULL,
  `created` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- enable foreign key checks
SET FOREIGN_KEY_CHECKS=1;
