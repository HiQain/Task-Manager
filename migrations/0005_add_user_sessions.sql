CREATE TABLE IF NOT EXISTS `user_sessions` (
  `sid` varchar(191) NOT NULL PRIMARY KEY,
  `user_id` int NULL,
  `sess` longtext NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `user_sessions_user_id_users_id_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
);

CREATE INDEX `user_sessions_user_id_idx` ON `user_sessions` (`user_id`);
CREATE INDEX `user_sessions_expires_at_idx` ON `user_sessions` (`expires_at`);
