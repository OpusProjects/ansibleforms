USE `AnsibleForms`;
CREATE TABLE `designer_lock` (
  `id` tinyint(4) NOT NULL,
  `data` mediumtext DEFAULT NULL,
  `created` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
