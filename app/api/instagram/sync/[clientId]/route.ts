import { NextRequest, NextResponse } from "next/server";
import { syncInstagramForClient } from "@/lib/instagram";

type SyncRange = {
  days?: number;
  since?: number;
  until?: number;
};

function parseInteger(value: string | null) {
  if (value == null || value === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function sanitizeSyncRange(range: SyncRange): SyncRange {
  const sanitized: SyncRange = {};
  if (range.days != null && range.days > 0) sanitized.days = range.days;
  if (range.since != null) sanitized.since = range.since;
  if (range.until != null) sanitized.until = range.until;
  return sanitized;
}

async function runSync(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
  bodyRange?: SyncRange
) {
  const { clientId } = await context.params;
  const { searchParams } = request.nextUrl;
  const redirect = searchParams.get("redirect") !== "false";
  const queryRange: SyncRange = {
    days: parseInteger(searchParams.get("days")),
    since: parseInteger(searchParams.get("since")),
    until: parseInteger(searchParams.get("until"))
  };
  const range = sanitizeSyncRange({
    days: queryRange.days ?? bodyRange?.days,
    since: queryRange.since ?? bodyRange?.since,
    until: queryRange.until ?? bodyRange?.until
  });

  try {
    await syncInstagramForClient(clientId, Object.keys(range).length > 0 ? range : undefined);
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> }
) {
  return runSync(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> }
) {
  let bodyRange: SyncRange | undefined;
  try {
    const body = (await request.json()) as SyncRange;
    bodyRange = sanitizeSyncRange({
      days: typeof body?.days === "number" ? Math.floor(body.days) : undefined,
      since: typeof body?.since === "number" ? Math.floor(body.since) : undefined,
      until: typeof body?.until === "number" ? Math.floor(body.until) : undefined
    });
  } catch {
    bodyRange = undefined;
  }

  return runSync(request, context, bodyRange);
}
