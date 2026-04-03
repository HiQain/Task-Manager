CREATE TABLE IF NOT EXISTS `task_comments` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `task_id` int NOT NULL,
  `user_id` int NOT NULL,
  `content` longtext NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `task_comments_task_id_tasks_id_fk`
    FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `task_comments_user_id_users_id_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE INDEX `task_comments_task_id_idx` ON `task_comments` (`task_id`);
