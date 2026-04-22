import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clients, instagramAccounts, postsCache, accountInsightsCache, storiesHistory, users } from "@/db/schema";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { clientId } = await params;

  await db.delete(postsCache).where(eq(postsCache.clientId, clientId));
  await db.delete(accountInsightsCache).where(eq(accountInsightsCache.clientId, clientId));
  await db.delete(storiesHistory).where(eq(storiesHistory.clientId, clientId));
  await db.delete(instagramAccounts).where(eq(instagramAccounts.clientId, clientId));
  await db.delete(users).where(eq(users.clientId, clientId));
  await db.delete(clients).where(eq(clients.id, clientId));

  return NextResponse.json({ ok: true });
}
