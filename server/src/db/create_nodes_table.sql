USE `AnsibleForms`;
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
