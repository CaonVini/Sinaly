import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
await migrate(db, { migrationsFolder: "./drizzle" });
await pool.end();
console.log("Migrations aplicadas.");
