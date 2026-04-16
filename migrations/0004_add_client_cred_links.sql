SET @client_cred_link_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'client_cred_projects'
    AND COLUMN_NAME = 'link'
);

SET @client_cred_link_sql = IF(
  @client_cred_link_exists = 0,
  'ALTER TABLE client_cred_projects ADD COLUMN link TEXT NULL AFTER project_name',
  'SELECT 1'
);

PREPARE client_cred_link_stmt FROM @client_cred_link_sql;
EXECUTE client_cred_link_stmt;
DEALLOCATE PREPARE client_cred_link_stmt;
