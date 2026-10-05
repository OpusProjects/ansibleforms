USE `AnsibleForms`;
CREATE TABLE `runners` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(250) NOT NULL,
  `type` varchar(20) NOT NULL,
  `description` text DEFAULT NULL,
  `uri` varchar(500) NOT NULL,
  `token` text DEFAULT NULL,
  `ignore_certs` tinyint(4) DEFAULT 0,
  `ca_bundle` text DEFAULT NULL,
  `is_default` tinyint(4) DEFAULT 0,
  `managed` tinyint(4) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_AnsibleForms_runners_natural_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
