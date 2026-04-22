import { eq } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InvitePasswordForm } from "@/components/convite/InvitePasswordForm";
import { db } from "@/db";
import { inviteTokens } from "@/db/schema";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function ConvitePage(props: PageProps) {
  const { token } = await props.params;

  const [invite] = await db.select().from(inviteTokens).where(eq(inviteTokens.token, token)).limit(1);

  const now = new Date();
  const invalid =
    !invite || invite.usedAt !== null || now > invite.expiresAt;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5F5F5] px-6 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Definir senha</CardTitle>
          {invalid ? (
            <p className="text-sm text-neutral-600">
              Este convite é inválido, já foi usado ou expirou. Solicite um novo convite ao administrador.
            </p>
          ) : (
            <p className="text-sm text-neutral-600">
              Crie uma senha para acessar o dashboard do seu conteúdo ({invite.email}).
            </p>
          )}
        </CardHeader>
        <CardContent>{invalid ? null : <InvitePasswordForm token={token} />}</CardContent>
      </Card>
    </main>
  );
}
