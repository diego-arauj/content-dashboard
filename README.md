# Content Dashboard

Plataforma de analytics de Instagram para gestão de conteúdo, construída com Next.js 14, PostgreSQL direto, Drizzle ORM, Auth.js v5 e Instagram Graph API.

## Stack

- Next.js 14 (App Router) + TypeScript
- PostgreSQL + Drizzle ORM
- Auth.js v5 (NextAuth) com provider de credenciais
- Tailwind CSS
- Recharts
- Componentes base no estilo shadcn/ui

## Setup

1. Instale dependências:

```bash
npm install
```

2. Copie o arquivo de ambiente:

```bash
cp .env.local.example .env.local
```

3. Preencha variáveis no `.env.local`:

- `DATABASE_URL`
- `AUTH_SECRET`
- `META_APP_ID`
- `META_APP_SECRET`
- `NEXT_PUBLIC_BASE_URL` (ex: `http://localhost:3000`)
- `ENCRYPTION_KEY` (gerar com `openssl rand -hex 32`)

Para Easypanel, monte `DATABASE_URL` no formato:
`postgresql://postgres:suasenha@nomedoprojeto_nomedoservico:5432/postgres`

4. Gere e aplique as migrations:

```bash
npm run db:generate
npm run db:migrate
```

5. Crie o usuário admin:

```bash
npm run create-admin
```

6. Rode o projeto:

```bash
npm run dev
```

## Fluxo de uso

1. Faça login em `/login` com a conta admin criada no script `create-admin`.
2. Em `/dashboard`, crie um cliente no modal "Novo cliente".
3. Na tela de onboarding do cliente, conecte o Instagram via OAuth Meta.
4. Após callback, o sistema salva token criptografado e executa sincronização inicial.
5. No dashboard do cliente, acompanhe métricas, evolução diária, grid de posts e top posts.

## Segurança

- `access_token` do Instagram é criptografado com AES-256-GCM (`lib/encryption.ts`).
- Middleware protege `/dashboard/*` e `/api/*` verificando sessão ativa com Auth.js.

## Rotas principais

- `/login`
- `/dashboard`
- `/dashboard/[clientId]`
- `/dashboard/[clientId]/onboarding`
- `/api/auth/instagram/callback`
- `/api/instagram/sync/[clientId]`
