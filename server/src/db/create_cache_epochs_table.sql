USE `AnsibleForms`;
CREATE TABLE `cache_epochs` (
  `name` varchar(64) NOT NULL,
  `version` bigint(20) NOT NULL DEFAULT 0,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
