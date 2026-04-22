-- Clientes
create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  niche text,
  created_at timestamptz default now()
);

-- Contas do Instagram vinculadas
create table instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  ig_user_id text not null,
  username text not null,
  access_token text not null,      -- armazenar encriptado
  token_expires_at timestamptz,
  connected_at timestamptz default now()
);

-- Cache de posts
create table posts_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  ig_media_id text unique not null,
  timestamp timestamptz,
  media_type text,
  caption text,
  likes int default 0,
  comments int default 0,
  reach int default 0,
  impressions int default 0,
  saved int default 0,
  shares int default 0,
  thumbnail_url text,
  permalink text,
  synced_at timestamptz default now()
);

-- Cache de insights da conta (por dia)
create table account_insights_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  date date not null,
  followers int default 0,
  reach int default 0,
  impressions int default 0,
  profile_views int default 0,
  unique(client_id, date)
);
