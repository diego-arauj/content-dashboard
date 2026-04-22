import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { clients, instagramAccounts } from "@/db/schema";
import { ClientCard } from "@/components/dashboard/ClientCard";
import { NewClientModal } from "@/components/dashboard/NewClientModal";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  if (session.user.role === "client" && session.user.clientId) {
    redirect(`/dashboard/${session.user.clientId}`);
  }

  const clientsRows = await db
    .select({
      id: clients.id,
      name: clients.name,
      niche: clients.niche,
      username: instagramAccounts.username
    })
    .from(clients)
    .leftJoin(instagramAccounts, eq(instagramAccounts.clientId, clients.id))
    .orderBy(desc(clients.createdAt));

  return (
    <main className="min-h-screen bg-[#F5F5F5] px-6 py-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-4 border-b border-[#E5E5E5] pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Clientes</h1>
            <p className="mt-1 text-sm text-neutral-600">Gerencie conexões de Instagram e dashboards individuais.</p>
          </div>
          <div className="flex items-center gap-3">
            <form action="/auth/signout" method="post">
              <Button variant="outline" type="submit">
                Sair
              </Button>
            </form>
            <NewClientModal />
          </div>
        </header>

        {clientsRows.length ? (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {clientsRows.map((client) => (
              <ClientCard
                key={client.id}
                id={client.id}
                name={client.name}
                niche={client.niche}
                username={client.username ?? null}
              />
            ))}
          </section>
        ) : (
          <div className="rounded-xl border border-[#E5E5E5] bg-white p-10 text-center text-neutral-600 shadow-subtle">
            Nenhum cliente cadastrado. Crie o primeiro para começar.
          </div>
        )}
      </div>
    </main>
  );
}
