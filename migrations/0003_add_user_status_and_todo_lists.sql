SET @is_active_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'is_active'
);

SET @is_active_sql = IF(
  @is_active_exists = 0,
  'ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE',
  'SELECT 1'
);

PREPARE is_active_stmt FROM @is_active_sql;
EXECUTE is_active_stmt;
DEALLOCATE PREPARE is_active_stmt;

SET @must_change_password_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'must_change_password'
);

SET @must_change_password_sql = IF(
  @must_change_password_exists = 0,
  'ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE',
  'SELECT 1'
);

PREPARE must_change_password_stmt FROM @must_change_password_sql;
EXECUTE must_change_password_stmt;
DEALLOCATE PREPARE must_change_password_stmt;

CREATE TABLE IF NOT EXISTS todo_lists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  created_by_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_todo_lists_created_by
    FOREIGN KEY (created_by_id) REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS todo_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  list_id INT NOT NULL,
  content VARCHAR(255) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_todo_items_list
    FOREIGN KEY (list_id) REFERENCES todo_lists(id)
    ON DELETE CASCADE
);
