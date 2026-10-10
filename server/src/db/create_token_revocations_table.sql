USE `AnsibleForms`;
-- revoked tokens : a session ended by a logout (sid:<id>), every session of a user issued before
-- a password change (user:<type>/<name>, revoked_before in unix seconds) : lib/tokenRevocation.js
CREATE TABLE IF NOT EXISTS `token_revocations` (
  `key` varchar(300) NOT NULL,
  `revoked_before` bigint DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
