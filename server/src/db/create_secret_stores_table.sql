USE `AnsibleForms`;
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
