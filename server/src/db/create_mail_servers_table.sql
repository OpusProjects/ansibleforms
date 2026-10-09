USE `AnsibleForms`;
CREATE TABLE `mail_servers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(250) NOT NULL,
  `description` text DEFAULT NULL,
  `server` varchar(250) NOT NULL,
  `port` int(11) DEFAULT NULL,
  `secure` tinyint(4) DEFAULT 0,
  `from_address` varchar(250) DEFAULT NULL,
  -- an smtp credential of Connections > Credentials : the login, none for an open relay
  `credential` varchar(250) DEFAULT NULL,
  -- the one the app sends its mail with
  `is_active` tinyint(4) DEFAULT 0,
  `managed` tinyint(4) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_AnsibleForms_mail_servers_natural_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
