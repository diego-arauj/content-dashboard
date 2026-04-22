import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

migrate(db, { migrationsFolder: "./drizzle" }).then(() => {
  // eslint-disable-next-line no-console
  console.log("Migrations applied");
  pool.end();
});
