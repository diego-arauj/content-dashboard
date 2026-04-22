import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  params
}: PageProps<"/dashboard/[clientId]/onboarding">) {
  const { clientId } = await params;

  const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, clientId));
  if (!client) {
    notFound();
  }

  const appId = process.env.META_APP_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!appId || !baseUrl) {
    throw new Error("META_APP_ID e NEXT_PUBLIC_BASE_URL precisam estar configurados.");
  }

  const redirectUri = `${baseUrl}/api/auth/instagram/callback`;
  const oauthUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  oauthUrl.searchParams.set("client_id", appId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set(
    "scope",
    "instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement"
  );
  oauthUrl.searchParams.set("state", clientId);

  return (
    <main className="min-h-screen bg-[#F5F5F5] px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Conectar Instagram de {client.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm leading-relaxed text-neutral-700">
              Autorize o acesso à conta Instagram Business do cliente para sincronizar posts e insights dos últimos 30
              dias. O token será armazenado com criptografia AES-256.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href={oauthUrl.toString()}>Conectar Instagram</a>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/dashboard">Voltar para clientes</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
