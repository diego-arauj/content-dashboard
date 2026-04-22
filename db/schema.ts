import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  niche: text("niche"),
  createdAt: timestamp("created_at").defaultNow()
});

export const instagramAccounts = pgTable("instagram_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  igUserId: text("ig_user_id").notNull(),
  username: text("username").notNull(),
  accessToken: text("access_token").notNull(),
  tokenExpiresAt: timestamp("token_expires_at"),
  connectedAt: timestamp("connected_at").defaultNow(),
  followersCount: integer("followers_count"),
  profilePictureUrl: text("profile_picture_url")
});

export const postsCache = pgTable("posts_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  igMediaId: text("ig_media_id").unique().notNull(),
  timestamp: timestamp("timestamp"),
  mediaType: text("media_type"),
  caption: text("caption"),
  likes: integer("likes").default(0),
  comments: integer("comments").default(0),
  reach: integer("reach").default(0),
  impressions: integer("impressions").default(0),
  saved: integer("saved").default(0),
  shares: integer("shares").default(0),
  linkClicks: integer("link_clicks").default(0),
  thumbnailUrl: text("thumbnail_url"),
  mediaUrl: text("media_url"),
  permalink: text("permalink"),
  syncedAt: timestamp("synced_at").defaultNow()
});

export const accountInsightsCache = pgTable(
  "account_insights_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    followers: integer("followers").default(0),
    reach: integer("reach").default(0),
    impressions: integer("impressions").default(0),
    profileViews: integer("profile_views").default(0),
    websiteClicks: integer("website_clicks").default(0)
  },
  (t) => ({
    uniq: unique().on(t.clientId, t.date)
  })
);

export const storiesHistory = pgTable(
  "stories_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    syncedAt: timestamp("synced_at").defaultNow(),
    date: text("date").notNull(),
    totalStories: integer("total_stories").default(0),
    totalViews: integer("total_views").default(0)
  },
  (t) => ({
    uniq: unique().on(t.clientId, t.date)
  })
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().default(""),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow()
});

export const inviteTokens = pgTable("invite_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").unique().notNull(),
  email: text("email").notNull(),
  clientId: uuid("client_id")
    .references(() => clients.id, { onDelete: "cascade" })
    .notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow()
});

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires").notNull()
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires").notNull()
});
