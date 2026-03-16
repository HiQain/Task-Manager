const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config();

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  const migrationPath = path.join(__dirname, "..", "migrations", "0001_add_task_comments.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");

  const connection = await mysql.createConnection({
    uri: dbUrl,
    multipleStatements: true,
  });

  try {
    await connection.query(sql);
    console.log("✅ Migration applied: 0001_add_task_comments.sql");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("❌ Migration failed:", err.message || err);
  process.exit(1);
});
