import bcrypt from "bcryptjs";
import { db } from "../db";
import { users } from "../db/schema";

async function createAdmin() {
  const email = "admin@seudominio.com";
  const password = "suasenhaforte";

  const passwordHash = await bcrypt.hash(password, 12);

  await db.insert(users).values({ name: "Admin", email, passwordHash });
  // eslint-disable-next-line no-console
  console.log("Admin criado com sucesso!");
  process.exit(0);
}

createAdmin();
