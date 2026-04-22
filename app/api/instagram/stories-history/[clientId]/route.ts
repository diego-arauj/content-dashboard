import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { storiesHistory } from "@/db/schema";

export async function GET(
  _request: Request,
  context: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await context.params;

  const rows = await db
    .select({
      date: storiesHistory.date,
      totalStories: storiesHistory.totalStories,
      totalViews: storiesHistory.totalViews,
      syncedAt: storiesHistory.syncedAt
    })
    .from(storiesHistory)
    .where(eq(storiesHistory.clientId, clientId))
    .orderBy(asc(storiesHistory.date));

  return NextResponse.json({ data: rows });
}
