import { addSeconds } from "date-fns";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { instagramAccounts } from "@/db/schema";
import { encrypt } from "@/lib/encryption";
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  getFacebookPages,
  getInstagramBusinessAccount,
  syncInstagramForClient
} from "@/lib/instagram";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const clientId = url.searchParams.get("state");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  if (!code || !clientId || !baseUrl) {
    return NextResponse.json({ error: "Callback inválido." }, { status: 400 });
  }

  const redirectUri = `${baseUrl}/api/auth/instagram/callback`;

  try {
    const shortToken = await exchangeCodeForShortLivedToken(code, redirectUri);
    const longToken = await exchangeForLongLivedToken(shortToken.access_token);
    const pages = await getFacebookPages(longToken.access_token);

    let igUserId: string | null = null;
    let username: string | null = null;

    for (const page of pages.data) {
      const pageData = await getInstagramBusinessAccount(page.id, page.access_token);
      if (pageData.instagram_business_account) {
        igUserId = pageData.instagram_business_account.id;
        username = pageData.instagram_business_account.username;
        break;
      }
    }

    if (!igUserId || !username) {
      return NextResponse.json(
        { error: "Nenhuma conta Instagram Business vinculada foi encontrada nas páginas do Facebook." },
        { status: 400 }
      );
    }

    await db.delete(instagramAccounts).where(eq(instagramAccounts.clientId, clientId));
    await db.insert(instagramAccounts).values({
      clientId,
      igUserId,
      username,
      accessToken: encrypt(longToken.access_token),
      tokenExpiresAt: longToken.expires_in ? addSeconds(new Date(), Number(longToken.expires_in)) : null
    });

    await syncInstagramForClient(clientId);

    return NextResponse.redirect(new URL(`/dashboard/${clientId}`, request.url));
  } catch (error) {
    console.error("OAUTH ERROR:", error);
    const message = error instanceof Error ? error.message : "Falha no OAuth do Instagram.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
