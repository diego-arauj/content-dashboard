import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accountInsightsCache, instagramAccounts, postsCache } from "@/db/schema";
import { decrypt } from "@/lib/encryption";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

type GraphResponse<T> = T & {
  error?: {
    message: string;
    type: string;
    code: number;
  };
};

type MediaItem = {
  id: string;
  caption?: string;
  media_type?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
};

async function graphGet<T>(path: string, params: Record<string, string | number>) {
  const query = new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {})
  ).toString();

  const response = await fetch(`${GRAPH_API_BASE}${path}?${query}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store"
  });

  const data = (await response.json()) as GraphResponse<T>;

  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? "Instagram Graph API request failed.");
  }

  return data;
}

async function graphPost<T>(path: string, body: Record<string, string>) {
  const response = await fetch(`${GRAPH_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body),
    cache: "no-store"
  });

  const data = (await response.json()) as GraphResponse<T>;

  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? "Instagram Graph API request failed.");
  }

  return data;
}

export async function exchangeCodeForShortLivedToken(code: string, redirectUri: string) {
  return graphPost<{ access_token: string; token_type: string; expires_in: number }>(
    "/oauth/access_token",
    {
      client_id: process.env.META_APP_ID ?? "",
      client_secret: process.env.META_APP_SECRET ?? "",
      redirect_uri: redirectUri,
      code
    }
  );
}

export async function exchangeForLongLivedToken(shortLivedToken: string) {
  return graphGet<{ access_token: string; token_type: string; expires_in: number }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    fb_exchange_token: shortLivedToken
  });
}

export async function getFacebookPages(userToken: string) {
  return graphGet<{ data: Array<{ id: string; name: string; access_token: string }> }>("/me/accounts", {
    fields: "id,name,access_token",
    access_token: userToken
  });
}

export async function getInstagramBusinessAccount(pageId: string, pageAccessToken: string) {
  return graphGet<{ instagram_business_account?: { id: string; username: string } }>(`/${pageId}`, {
    fields: "instagram_business_account{id,username}",
    access_token: pageAccessToken
  });
}

function getInt(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10) || 0;
  return 0;
}

/** Métrica única em /{media-id}/insights; falha silenciosamente (0) */
async function tryMediaMetricInsight(mediaId: string, metric: string, accessToken: string): Promise<number> {
  try {
    const insights = await graphGet<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
      `/${mediaId}/insights`,
      { metric, access_token: accessToken }
    );
    const row = insights.data.find((m) => m.name === metric);
    return getInt(row?.values?.[0]?.value ?? 0);
  } catch {
    return 0;
  }
}

/** Soma impressões (como proxy de views) dos stories informados */
export async function sumStoryImpressionsAsViews(storyIds: string[], accessToken: string): Promise<number> {
  let total = 0;
  for (const id of storyIds) {
    total += await tryMediaMetricInsight(id, "impressions", accessToken);
  }
  return total;
}

export type SyncInstagramOptions = {
  /** Unix segundos — insights da conta; se omitido, usa últimos 30 dias até agora */
  since?: number;
  until?: number;
};

export async function fetchInstagramStories(igUserId: string, accessToken: string) {
  return graphGet<{
    data: Array<{
      id: string;
      timestamp?: string;
      media_type?: string;
      like_count?: number;
      replies_count?: number;
    }>;
  }>(`/${igUserId}/stories`, {
    fields: "id,timestamp,media_type,like_count,replies_count",
    access_token: accessToken
  });
}

export async function syncInstagramForClient(clientId: string, options?: SyncInstagramOptions) {
  const [account] = await db
    .select({
      igUserId: instagramAccounts.igUserId,
      accessToken: instagramAccounts.accessToken
    })
    .from(instagramAccounts)
    .where(eq(instagramAccounts.clientId, clientId));

  if (!account) {
    throw new Error("Conta do Instagram não encontrada para este cliente.");
  }

  const accessToken = decrypt(account.accessToken);
  const igUserId = account.igUserId;

  const profile = await graphGet<{ followers_count: number; profile_picture_url: string; username: string }>(
    `/${igUserId}`,
    { fields: "followers_count,profile_picture_url,username", access_token: accessToken }
  );

  await db
    .update(instagramAccounts)
    .set({
      followersCount: profile.followers_count,
      profilePictureUrl: profile.profile_picture_url,
      username: profile.username
    })
    .where(eq(instagramAccounts.clientId, clientId));

  const media = await graphGet<{ data: MediaItem[] }>(`/${igUserId}/media`, {
    fields:
      "id,caption,media_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url",
    limit: 30,
    access_token: accessToken
  });

  for (const item of media.data) {
    let metrics: Record<string, number> = {};

    try {
      const metricList = item.media_type === "VIDEO" ? "reach,saved,shares" : "reach,saved,shares";
      const insights = await graphGet<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
        `/${item.id}/insights`,
        {
          metric: metricList,
          access_token: accessToken
        }
      );
      metrics = insights.data.reduce<Record<string, number>>((acc, metric) => {
        acc[metric.name] = getInt(metric.values?.[0]?.value ?? 0);
        return acc;
      }, {});
    } catch (err) {
      // eslint-disable-next-line no-console -- insights opcionais por tipo de mídia
      console.warn(`Insights indisponíveis para ${item.id} (${item.media_type}):`, err instanceof Error ? err.message : err);
    }

    const likes = getInt(item.like_count);
    const comments = getInt(item.comments_count);
    const linkClicks = await tryMediaMetricInsight(item.id, "link_clicks", accessToken);

    await db
      .insert(postsCache)
      .values({
        clientId,
        igMediaId: item.id,
        timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
        mediaType: item.media_type ?? "IMAGE",
        caption: item.caption ?? "",
        likes,
        comments,
        reach: metrics.reach ?? 0,
        impressions: 0,
        saved: metrics.saved ?? 0,
        shares: metrics.shares ?? 0,
        linkClicks,
        thumbnailUrl: item.thumbnail_url ?? null,
        mediaUrl: item.media_url ?? null,
        permalink: item.permalink ?? null,
        syncedAt: new Date()
      })
      .onConflictDoUpdate({
        target: postsCache.igMediaId,
        set: {
          timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
          mediaType: item.media_type ?? "IMAGE",
          caption: item.caption ?? "",
          likes,
          comments,
          reach: metrics.reach ?? 0,
          impressions: 0,
          saved: metrics.saved ?? 0,
          shares: metrics.shares ?? 0,
          linkClicks,
          thumbnailUrl: item.thumbnail_url ?? null,
          mediaUrl: item.media_url ?? null,
          permalink: item.permalink ?? null,
          syncedAt: new Date()
        }
      });
  }

  const now = Math.floor(Date.now() / 1000);
  let since = options?.since ?? now - 30 * 24 * 60 * 60;
  let until = options?.until ?? now;
  if (since > until) {
    const t = since;
    since = until;
    until = t;
  }

  const accountInsightsPath = `/${igUserId}/insights`;
  const accountInsightsParams: Record<string, string | number> = {
    metric: "follower_count,reach,website_clicks",
    period: "day",
    since,
    until,
    access_token: accessToken
  };
  const queryString = new URLSearchParams(
    Object.entries(accountInsightsParams).reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {})
  ).toString();
  const url = `${GRAPH_API_BASE}${accountInsightsPath}?${queryString}`;

  const accountInsightsResponse = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store"
  });

  const accountInsightsJson = (await accountInsightsResponse.json()) as GraphResponse<{
    data: Array<{ name: string; values: Array<{ value: number; end_time: string }> }>;
  }>;

  if (!accountInsightsResponse.ok || accountInsightsJson.error) {
    throw new Error(accountInsightsJson.error?.message ?? "Instagram Graph API request failed.");
  }

  const accountInsights = accountInsightsJson;

  const byDate = new Map<
    string,
    { followers: number; reach: number; impressions: number; profileViews: number; websiteClicks: number }
  >();

  try {
    for (const metric of accountInsights.data) {
      for (const entry of metric.values) {
        const key = entry.end_time.slice(0, 10);
        const current = byDate.get(key) ?? {
          followers: 0,
          reach: 0,
          impressions: 0,
          profileViews: 0,
          websiteClicks: 0
        };
        if (metric.name === "follower_count") {
          current.followers = getInt(entry.value);
        } else if (metric.name === "reach") {
          current.reach = getInt(entry.value);
        } else if (metric.name === "impressions") {
          current.impressions = getInt(entry.value);
        } else if (metric.name === "profile_views") {
          current.profileViews = getInt(entry.value);
        } else if (metric.name === "website_clicks") {
          current.websiteClicks = getInt(entry.value);
        }
        byDate.set(key, current);
      }
    }

    for (const [date, values] of byDate.entries()) {
      await db
        .insert(accountInsightsCache)
        .values({
          clientId,
          date,
          followers: values.followers,
          reach: values.reach,
          impressions: values.impressions,
          profileViews: values.profileViews,
          websiteClicks: values.websiteClicks
        })
        .onConflictDoUpdate({
          target: [accountInsightsCache.clientId, accountInsightsCache.date],
          set: {
            followers: values.followers,
            reach: values.reach,
            impressions: values.impressions,
            profileViews: values.profileViews,
            websiteClicks: values.websiteClicks
          }
        });
    }
  } catch (err) {
    console.error("ERRO no processamento de insights da conta:", err);
    throw err;
  }
}
