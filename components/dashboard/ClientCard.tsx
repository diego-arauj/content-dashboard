"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InviteClientModal } from "@/components/dashboard/InviteClientModal";

type ClientCardProps = {
  id: string;
  name: string;
  niche: string | null;
  username: string | null;
};

export function ClientCard({ id, name, niche, username }: ClientCardProps) {
  const isConnected = Boolean(username);
  const href = isConnected ? `/dashboard/${id}` : `/dashboard/${id}/onboarding`;
  const handleDeleteClient = async () => {
    const confirmed = window.confirm("Tem certeza que deseja excluir este cliente?");
    if (!confirmed) return;

    const response = await fetch(`/api/clients/${id}/delete`, { method: "DELETE" });
    if (!response.ok) {
      window.alert("Não foi possível excluir o cliente.");
      return;
    }

    window.location.reload();
  };

  return (
    <Card className="h-full">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-xl">{name}</CardTitle>
          <Badge variant={isConnected ? "success" : "warning"}>{isConnected ? "Conectado" : "Pendente"}</Badge>
        </div>
        <p className="text-sm text-neutral-600">{niche || "Sem nicho definido"}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-neutral-700">
          Instagram: <span className="font-medium">{username ? `@${username}` : "Não conectado"}</span>
        </p>
        <div className="space-y-2">
          <Link href={href as Route} className={cn(buttonVariants(), "w-full")}>
            {isConnected ? "Abrir dashboard" : "Conectar Instagram"}
          </Link>
          {isConnected ? <InviteClientModal clientId={id} /> : null}
          <button
            type="button"
            onClick={handleDeleteClient}
            className="inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
            Excluir cliente
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
