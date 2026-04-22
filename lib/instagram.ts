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
  /** Quantidade de dias para trás a partir de `until` (padrão 30). */
  days?: number;
  /** Unix segundos — pode ser usado para sobrescrever o início do período. */
  since?: number;
  /** Unix segundos — pode ser usado para sobrescrever o fim do período. */
  until?: number;
};

const DAY_IN_SECONDS = 24 * 60 * 60;
const MAX_INSIGHTS_WINDOW_DAYS = 89;

function toUnixSeconds(date: string | undefined) {
  if (!date) return null;
  const seconds = Math.floor(new Date(date).getTime() / 1000);
  return Number.isFinite(seconds) ? seconds : null;
}

async function fetchMediaByCursorUntilDate(
  igUserId: string,
  accessToken: string,
  periodStartUnix: number
): Promise<MediaItem[]> {
  const collected: MediaItem[] = [];
  let after: string | undefined;

  while (true) {
    const media = await graphGet<{
      data: MediaItem[];
      paging?: { cursors?: { after?: string } };
    }>(`/${igUserId}/media`, {
      fields:
        "id,caption,media_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url",
      limit: 50,
      ...(after ? { after } : {}),
      access_token: accessToken
    });

    let reachedOlderThanPeriod = false;
    for (const item of media.data) {
      const itemUnix = toUnixSeconds(item.timestamp);
      if (itemUnix != null && itemUnix < periodStartUnix) {
        reachedOlderThanPeriod = true;
        continue;
      }
      collected.push(item);
    }

    if (reachedOlderThanPeriod) {
      break;
    }

    const nextCursor = media.paging?.cursors?.after;
    if (!nextCursor || nextCursor === after) {
      break;
    }
    after = nextCursor;
  }

  return collected;
}

async function fetchAccountInsightsByWindows(
  igUserId: string,
  accessToken: string,
  since: number,
  until: number
) {
  const allMetrics: Array<{ name: string; values: Array<{ value: number; end_time: string }> }> = [];
  const step = MAX_INSIGHTS_WINDOW_DAYS * DAY_IN_SECONDS;

  for (let windowEnd = until; windowEnd > since; windowEnd -= step) {
    const windowStart = Math.max(windowEnd - step, since);
    const windowData = await graphGet<{
      data: Array<{ name: string; values: Array<{ value: number; end_time: string }> }>;
    }>(`/${igUserId}/insights`, {
      metric: "follower_count,reach,impressions,profile_views,website_clicks",
      period: "day",
      since: windowStart,
      until: windowEnd,
      access_token: accessToken
    });
    allMetrics.push(...windowData.data);
  }

  return allMetrics;
}

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

  const now = Math.floor(Date.now() / 1000);
  const normalizedUntil = options?.until ?? now;
  const requestedDays = options?.days != null && options.days > 0 ? Math.floor(options.days) : 30;
  const normalizedSince = options?.since ?? normalizedUntil - requestedDays * DAY_IN_SECONDS;
  let since = normalizedSince;
  let until = normalizedUntil;
  if (since > until) {
    const tmp = since;
    since = until;
    until = tmp;
  }

  const media = await fetchMediaByCursorUntilDate(igUserId, accessToken, since);

  for (const item of media) {
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

  const accountInsights = await fetchAccountInsightsByWindows(igUserId, accessToken, since, until);

  const byDate = new Map<
    string,
    { followers: number; reach: number; impressions: number; profileViews: number; websiteClicks: number }
  >();

  try {
    for (const metric of accountInsights) {
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
