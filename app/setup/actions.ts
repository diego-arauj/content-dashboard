"use server";

import bcrypt from "bcryptjs";
import { count } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export type CreateFirstUserResult = { ok: true } | { error: string };

export async function createFirstUser(formData: FormData): Promise<CreateFirstUserResult> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name) return { error: "Informe o nome." };
  if (!email) return { error: "Informe o email." };
  if (password.length < 8) return { error: "A senha deve ter pelo menos 8 caracteres." };

  const [{ c }] = await db.select({ c: count() }).from(users);
  if (c > 0) {
    return { error: "Já existe um usuário cadastrado. Acesse o login." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await db.insert(users).values({ name, email, passwordHash });
  } catch {
    return { error: "Não foi possível criar o usuário. Verifique o email." };
  }

  return { ok: true };
}
