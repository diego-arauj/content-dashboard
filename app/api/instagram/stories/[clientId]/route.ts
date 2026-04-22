import { format } from "date-fns";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { instagramAccounts, storiesHistory } from "@/db/schema";
import { decrypt } from "@/lib/encryption";
import { fetchInstagramStories, sumStoryImpressionsAsViews } from "@/lib/instagram";

export async function GET(
  _request: Request,
  context: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await context.params;

  const [account] = await db
    .select({
      igUserId: instagramAccounts.igUserId,
      accessToken: instagramAccounts.accessToken
    })
    .from(instagramAccounts)
    .where(eq(instagramAccounts.clientId, clientId));

  if (!account) {
    return NextResponse.json({ error: "Conta do Instagram não encontrada para este cliente." }, { status: 404 });
  }

  try {
    const accessToken = decrypt(account.accessToken);
    const data = await fetchInstagramStories(account.igUserId, accessToken);
    const list = data.data ?? [];
    const ids = list.map((s) => s.id);
    const totalViews = await sumStoryImpressionsAsViews(ids, accessToken);
    const today = format(new Date(), "yyyy-MM-dd");

    await db
      .insert(storiesHistory)
      .values({
        clientId,
        date: today,
        totalStories: ids.length,
        totalViews
      })
      .onConflictDoUpdate({
        target: [storiesHistory.clientId, storiesHistory.date],
        set: {
          totalStories: ids.length,
          totalViews,
          syncedAt: new Date()
        }
      });

    return NextResponse.json(data);
  } catch (error) {
    console.error("STORIES ERROR:", error);
    const message = error instanceof Error ? error.message : "Falha ao buscar stories.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
