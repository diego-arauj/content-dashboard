"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inviteTokens, users } from "@/db/schema";

export async function completeInvite(token: string, password: string, confirmPassword: string) {
  if (password !== confirmPassword) {
    return { error: "As senhas não coincidem." };
  }
  if (password.length < 8) {
    return { error: "A senha deve ter pelo menos 8 caracteres." };
  }

  const [invite] = await db.select().from(inviteTokens).where(eq(inviteTokens.token, token)).limit(1);
  if (!invite) {
    return { error: "Convite inválido." };
  }
  if (invite.usedAt) {
    return { error: "Este convite já foi utilizado." };
  }
  if (new Date() > invite.expiresAt) {
    return { error: "Este convite expirou." };
  }

  const [existing] = await db.select().from(users).where(eq(users.email, invite.email)).limit(1);
  if (existing) {
    return { error: "Este email já está cadastrado." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const displayName = invite.email.split("@")[0] || "Cliente";

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      name: displayName,
      email: invite.email,
      passwordHash,
      clientId: invite.clientId
    });
    await tx.update(inviteTokens).set({ usedAt: new Date() }).where(eq(inviteTokens.id, invite.id));
  });

  redirect("/login?registered=1");
}
