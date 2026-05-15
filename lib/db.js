const { Pool } = require("pg");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.warn("DATABASE_URL is not set; database queries will fail until it is configured.");
}

const pool = new Pool(databaseUrl ? { connectionString: databaseUrl } : {});

module.exports = pool;
