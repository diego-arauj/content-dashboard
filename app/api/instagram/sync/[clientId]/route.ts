import { NextRequest, NextResponse } from "next/server";
import { syncInstagramForClient } from "@/lib/instagram";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await context.params;
  const { searchParams } = request.nextUrl;
  const redirect = searchParams.get("redirect") !== "false";
  const sinceParam = searchParams.get("since");
  const untilParam = searchParams.get("until");
  const since = sinceParam != null && sinceParam !== "" ? Number.parseInt(sinceParam, 10) : undefined;
  const until = untilParam != null && untilParam !== "" ? Number.parseInt(untilParam, 10) : undefined;
  const range =
    since != null && !Number.isNaN(since) && until != null && !Number.isNaN(until) ? { since, until } : undefined;

  try {
    await syncInstagramForClient(clientId, range);
    if (!redirect) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.redirect(new URL(`/dashboard/${clientId}`, request.url));
  } catch (error) {
    console.error("SYNC ERROR:", error);
    const message = error instanceof Error ? error.message : "Falha ao sincronizar dados do Instagram.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
