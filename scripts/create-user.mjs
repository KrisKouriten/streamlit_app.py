import pg from "pg";
import bcrypt from "bcryptjs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Run:  DATABASE_URL=... npm run create-user");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
});

const rl = readline.createInterface({ input: stdin, output: stdout });

try {
  const name = (await rl.question("Full name: ")).trim();
  const email = (await rl.question("Email (used to log in): ")).trim().toLowerCase();
  const password = (await rl.question("Password (min 8 chars): ")).trim();

  if (!name || !email || password.length < 8) {
    console.error("Name and email required; password must be at least 8 characters.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (email, name, password) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password = EXCLUDED.password`,
    [email, name, hash]
  );
  console.log(`User ready: ${name} <${email}>. They can now log in.`);
} catch (e) {
  console.error("Failed:", e.message);
  process.exit(1);
} finally {
  rl.close();
  await pool.end();
}
