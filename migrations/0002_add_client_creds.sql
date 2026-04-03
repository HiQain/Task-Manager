SET @allow_client_creds_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'allow_client_creds'
);

SET @allow_client_creds_sql = IF(
  @allow_client_creds_exists = 0,
  'ALTER TABLE users ADD COLUMN allow_client_creds BOOLEAN NOT NULL DEFAULT FALSE',
  'SELECT 1'
);

PREPARE allow_client_creds_stmt FROM @allow_client_creds_sql;
EXECUTE allow_client_creds_stmt;
DEALLOCATE PREPARE allow_client_creds_stmt;

UPDATE users
SET allow_client_creds = TRUE
WHERE LOWER(role) = 'admin';

CREATE TABLE IF NOT EXISTS client_cred_projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_name VARCHAR(255) NOT NULL,
  project_name VARCHAR(255) NOT NULL,
  via_channels LONGTEXT NOT NULL,
  emails LONGTEXT NOT NULL,
  passwords LONGTEXT NOT NULL,
  created_by_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_client_cred_projects_created_by
    FOREIGN KEY (created_by_id) REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS client_cred_project_accesses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  user_id INT NOT NULL,
  access VARCHAR(16) NOT NULL DEFAULT 'view',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_client_cred_project_accesses_project
    FOREIGN KEY (project_id) REFERENCES client_cred_projects(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_client_cred_project_accesses_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  UNIQUE KEY client_cred_access_project_user_idx (project_id, user_id)
);
