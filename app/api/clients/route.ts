import { NextResponse } from "next/server";
import { db } from "@/db";
import { clients } from "@/db/schema";

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string; niche?: string };
  const name = body.name?.trim();
  const niche = body.niche?.trim() || null;

  if (!name) {
    return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });
  }

  const [created] = await db.insert(clients).values({ name, niche }).returning({ id: clients.id });
  return NextResponse.json({ id: created.id, clientId: created.id });
}
