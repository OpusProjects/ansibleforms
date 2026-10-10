-- failed logins, by account (user:<name>) and by address (ip:<address>) : lib/loginThrottle.js
USE `AnsibleForms`;
CREATE TABLE IF NOT EXISTS `login_failures` (
  `key` varchar(300) NOT NULL,
  `failures` int NOT NULL DEFAULT 0,
  `first_at` datetime NOT NULL,
  `locked_until` datetime DEFAULT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
