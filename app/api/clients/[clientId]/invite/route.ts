import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { auth } from "@/auth";
import { db } from "@/db";
import { clients, inviteTokens } from "@/db/schema";

const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

export async function POST(request: Request, context: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  const { clientId } = await context.params;
  const body = (await request.json()) as { email?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Informe um email válido." }, { status: 400 });
  }

  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!apiKey || !baseUrl) {
    return NextResponse.json({ error: "Configuração de email incompleta no servidor." }, { status: 500 });
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await db.insert(inviteTokens).values({
    token,
    email,
    clientId,
    expiresAt
  });

  const resend = new Resend(apiKey);
  const inviteUrl = `${baseUrl}/convite/${token}`;

  const sendResult = await resend.emails.send({
    from: "noreply@conteudo.tgifmarketing.com.br",
    to: email,
    subject: "Convite — Dashboard de conteúdo",
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111;">
        <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Você foi convidado para acessar seu dashboard de conteúdo. Clique no botão abaixo para criar sua senha.</p>
        <a href="${inviteUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">Criar minha senha</a>
        <p style="font-size:13px;color:#666;margin:24px 0 0;">Se o botão não funcionar, copie e cole este link no navegador:<br/><span style="word-break:break-all;">${inviteUrl}</span></p>
      </div>
    `
  });

  if (sendResult.error) {
    await db.delete(inviteTokens).where(eq(inviteTokens.token, token));
    return NextResponse.json({ error: "Não foi possível enviar o email. Tente novamente." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
