"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewClientModal() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, niche })
    });

    const data = (await response.json()) as { id?: string; clientId?: string; error?: string };
    const clientId = data.clientId ?? data.id;

    setLoading(false);

    if (!response.ok || !clientId) {
      setError(data.error ?? "Falha ao criar cliente.");
      return;
    }

    setOpen(false);
    router.push(`/dashboard/${clientId}/onboarding`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Novo cliente</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar novo cliente</DialogTitle>
          <DialogDescription>Cadastre o cliente para iniciar o onboarding do Instagram.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="client-name">Nome</Label>
            <Input
              id="client-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              placeholder="Nome do cliente"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-niche">Nicho</Label>
            <Input
              id="client-niche"
              value={niche}
              onChange={(event) => setNiche(event.target.value)}
              placeholder="Ex: Moda, saúde, educação"
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? "Criando..." : "Criar cliente"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
