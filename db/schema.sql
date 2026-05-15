-- Run with: psql $DATABASE_URL -f db/schema.sql

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  niche TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instagram_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients (id) ON DELETE CASCADE,
  ig_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMP,
  connected_at TIMESTAMP DEFAULT now(),
  followers_count INTEGER,
  profile_picture_url TEXT
);

CREATE TABLE IF NOT EXISTS posts_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients (id) ON DELETE CASCADE,
  ig_media_id TEXT NOT NULL UNIQUE,
  timestamp TIMESTAMP,
  media_type TEXT,
  caption TEXT,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  saved INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  thumbnail_url TEXT,
  media_url TEXT,
  permalink TEXT,
  local_media_path TEXT,
  synced_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_insights_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  followers INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  profile_views INTEGER DEFAULT 0,
  website_clicks INTEGER DEFAULT 0,
  UNIQUE (client_id, date)
);

CREATE TABLE IF NOT EXISTS stories_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients (id) ON DELETE CASCADE,
  synced_at TIMESTAMP DEFAULT now(),
  date TEXT NOT NULL,
  total_stories INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,
  UNIQUE (client_id, date)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  client_id UUID REFERENCES clients (id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invite_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);
