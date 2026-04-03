const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config();

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  const migrationsDir = path.join(__dirname, "..", "migrations");
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const connection = await mysql.createConnection({
    uri: dbUrl,
    multipleStatements: true,
  });

  try {
    for (const migrationFile of migrationFiles) {
      const migrationPath = path.join(migrationsDir, migrationFile);
      const sql = fs.readFileSync(migrationPath, "utf8");
      try {
        await connection.query(sql);
        console.log(`✅ Migration applied: ${migrationFile}`);
      } catch (error) {
        const code = error && error.code;
        if (code === "ER_DUP_KEYNAME" || code === "ER_TABLE_EXISTS_ERROR" || code === "ER_DUP_FIELDNAME") {
          console.log(`ℹ️ Migration already satisfied: ${migrationFile} (${code})`);
          continue;
        }
        throw error;
      }
    }
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("❌ Migration failed:", err.message || err);
  process.exit(1);
});
