const pool = require("./db");
const { decrypt } = require("./encryption");

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

async function graphGet(pathStr, params) {
  const query = new URLSearchParams(
    Object.entries(params).reduce((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {})
  ).toString();

  const response = await fetch(`${GRAPH_API_BASE}${pathStr}?${query}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store"
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? "Instagram Graph API request failed.");
  }

  return data;
}

async function graphPost(pathStr, body) {
  const response = await fetch(`${GRAPH_API_BASE}${pathStr}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body),
    cache: "no-store"
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? "Instagram Graph API request failed.");
  }

  return data;
}

async function exchangeCodeForShortLivedToken(code, redirectUri) {
  return graphPost("/oauth/access_token", {
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    redirect_uri: redirectUri,
    code
  });
}

async function exchangeForLongLivedToken(shortLivedToken) {
  return graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    fb_exchange_token: shortLivedToken
  });
}

async function getFacebookPages(userToken) {
  return graphGet("/me/accounts", {
    fields: "id,name,access_token",
    access_token: userToken
  });
}

async function getInstagramBusinessAccount(pageId, pageAccessToken) {
  return graphGet(`/${pageId}`, {
    fields: "instagram_business_account{id,username}",
    access_token: pageAccessToken
  });
}

function getInt(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10) || 0;
  return 0;
}

/** Métrica única em /{media-id}/insights; falha silenciosamente (0) */
async function tryMediaMetricInsight(mediaId, metric, accessToken) {
  try {
    const insights = await graphGet(`/${mediaId}/insights`, { metric, access_token: accessToken });
    const row = insights.data.find((m) => m.name === metric);
    return getInt(row?.values?.[0]?.value ?? 0);
  } catch {
    return 0;
  }
}

/** Soma impressões (como proxy de views) dos stories informados */
async function sumStoryImpressionsAsViews(storyIds, accessToken) {
  let total = 0;
  for (const id of storyIds) {
    total += await tryMediaMetricInsight(id, "impressions", accessToken);
  }
  return total;
}

/** @typedef {{ days?: number; since?: number; until?: number }} SyncInstagramOptions */

const DAY_IN_SECONDS = 24 * 60 * 60;
/** Account insights: 25-day API windows with 5-day overlap between consecutive windows. */
const INSIGHTS_WINDOW_DAYS = 25;
const INSIGHTS_OVERLAP_DAYS = 5;

function inclusiveExpectedInsightDays(sinceSec, untilSec) {
  if (untilSec < sinceSec) return 0;
  return Math.floor((untilSec - sinceSec) / DAY_IN_SECONDS) + 1;
}

function countUniqueInsightDaysReturned(windowData) {
  const dates = new Set();
  for (const metric of windowData.data || []) {
    for (const entry of metric.values || []) {
      if (entry.end_time) {
        dates.add(entry.end_time.slice(0, 10));
      }
    }
  }
  return dates.size;
}

function toUnixSeconds(date) {
  if (!date) return null;
  const seconds = Math.floor(new Date(date).getTime() / 1000);
  return Number.isFinite(seconds) ? seconds : null;
}

async function fetchMediaByCursorUntilDate(igUserId, accessToken, periodStartUnix) {
  const collected = [];
  let after;
  let pageCount = 0;

  console.log(`[media] start fetch for ${igUserId}`);

  while (true) {
    pageCount++;
    const params = {
      fields:
        "id,caption,media_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url",
      limit: 50,
      access_token: accessToken
    };
    if (after) {
      params.after = after;
    }

    const media = await graphGet(`/${igUserId}/media`, params);

    let reachedOlderThanPeriod = false;
    for (const item of media.data) {
      const itemUnix = toUnixSeconds(item.timestamp);
      if (itemUnix != null && itemUnix < periodStartUnix) {
        reachedOlderThanPeriod = true;
        continue;
      }
      collected.push(item);
    }

    const batchLen = (media.data || []).length;
    console.log(
      `[media] page ${pageCount} got ${batchLen} items (total collected: ${collected.length})`
    );

    if (reachedOlderThanPeriod) {
      break;
    }

    const nextCursor = media.paging?.cursors?.after;
    if (!nextCursor || nextCursor === after) {
      break;
    }
    after = nextCursor;
  }

  console.log(`[media] done. total=${collected.length}`);

  return collected;
}

async function fetchReachByWindows(igUserId, accessToken, since, until, clientId) {
  const allMetrics = [];
  const windowSpanSec = INSIGHTS_WINDOW_DAYS * DAY_IN_SECONDS;
  const overlapSec = INSIGHTS_OVERLAP_DAYS * DAY_IN_SECONDS;

  let windowStart = since;
  while (windowStart < until) {
    const naturalEnd = windowStart + windowSpanSec;
    const windowEnd = Math.min(naturalEnd, until);

    console.log(`[reach] fetching ${windowStart} → ${windowEnd} for client ${clientId}`);

    const expected = inclusiveExpectedInsightDays(windowStart, windowEnd);

    try {
      const windowData = await graphGet(`/${igUserId}/insights`, {
        metric: "reach",
        period: "day",
        since: windowStart,
        until: windowEnd,
        access_token: accessToken
      });

      const actual = countUniqueInsightDaysReturned(windowData);

      if (actual < expected) {
        console.warn(
          `[reach] WARN: requested ${expected} days, got ${actual} for ${windowStart}→${windowEnd}`
        );
      }

      console.log(`[reach] window ${windowStart}→${windowEnd}: ${actual} days saved`);

      allMetrics.push(...(windowData.data || []));
    } catch (err) {
      console.error(
        `[reach] ERROR window ${windowStart}→${windowEnd}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (windowEnd >= until) {
      break;
    }

    windowStart = windowEnd - overlapSec;
  }

  return allMetrics;
}

async function fetchFollowerCountRecent(igUserId, accessToken, until, clientId) {
  const sinceFollow = until - 29 * DAY_IN_SECONDS;
  console.log(`[followers] fetching last 29 days for client ${clientId}`);

  try {
    const windowData = await graphGet(`/${igUserId}/insights`, {
      metric: "follower_count",
      period: "day",
      since: sinceFollow,
      until: until,
      access_token: accessToken
    });
    const count = countUniqueInsightDaysReturned(windowData);
    console.log(`[followers] got ${count} days`);
    return windowData.data || [];
  } catch (err) {
    console.error(`[followers] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function fetchInstagramStories(igUserId, accessToken) {
  return graphGet(`/${igUserId}/stories`, {
    fields: "id,timestamp,media_type,like_count,replies_count",
    access_token: accessToken
  });
}

/**
 * Sync Instagram data for a client.
 * Default lookback is **730 days** when `options.days` is omitted or ≤ 0.
 */
async function syncInstagramForClient(clientId, options) {
  console.time(`sync:${clientId}`);
  try {
    const accountResult = await pool.query(
      "SELECT ig_user_id, access_token FROM instagram_accounts WHERE client_id = $1 LIMIT 1",
      [clientId]
    );

    const account = accountResult.rows[0];

    if (!account) {
      throw new Error("Conta do Instagram não encontrada para este cliente.");
    }

    const accessToken = decrypt(account.access_token);
    const igUserId = account.ig_user_id;

    const profile = await graphGet(`/${igUserId}`, {
      fields: "followers_count,profile_picture_url,username",
      access_token: accessToken
    });

    await pool.query(
      `UPDATE instagram_accounts SET
      followers_count = $1,
      profile_picture_url = $2,
      username = $3
    WHERE client_id = $4`,
      [profile.followers_count, profile.profile_picture_url, profile.username, clientId]
    );

    const now = Math.floor(Date.now() / 1000);
    const normalizedUntil = options?.until ?? now;
    const requestedDays =
      options?.days != null && options.days > 0 ? Math.floor(options.days) : 730;
    const normalizedSince = options?.since ?? normalizedUntil - requestedDays * DAY_IN_SECONDS;
    let since = normalizedSince;
    let until = normalizedUntil;
    if (since > until) {
      const tmp = since;
      since = until;
      until = tmp;
    }

    console.log(
      `[sync] client=${clientId} since=${new Date(since * 1000).toISOString().slice(0, 10)} until=${new Date(until * 1000).toISOString().slice(0, 10)} days=${Math.round((until - since) / 86400)}`
    );

    const media = await fetchMediaByCursorUntilDate(igUserId, accessToken, since);

    console.log(`[posts] processing ${media.length} items`);

    for (let i = 0; i < media.length; i++) {
      const item = media[i];
      let metrics = {};

      try {
        const metricList = item.media_type === "VIDEO" ? "reach,saved,shares" : "reach,saved,shares";
        const insights = await graphGet(`/${item.id}/insights`, {
          metric: metricList,
          access_token: accessToken
        });
        metrics = insights.data.reduce((acc, metric) => {
          acc[metric.name] = getInt(metric.values?.[0]?.value ?? 0);
          return acc;
        }, {});
      } catch (err) {
        console.warn(
          `Insights indisponíveis para ${item.id} (${item.media_type}):`,
          err instanceof Error ? err.message : err
        );
      }

      const likes = getInt(item.like_count);
      const comments = getInt(item.comments_count);
      const linkClicks = await tryMediaMetricInsight(item.id, "link_clicks", accessToken);

      const ts = item.timestamp ? new Date(item.timestamp) : new Date();
      const syncedAt = new Date();

      await pool.query(
        `INSERT INTO posts_cache (
        client_id,
        ig_media_id,
        timestamp,
        media_type,
        caption,
        likes,
        comments,
        reach,
        impressions,
        saved,
        shares,
        link_clicks,
        thumbnail_url,
        media_url,
        permalink,
        synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (ig_media_id) DO UPDATE SET
        timestamp = EXCLUDED.timestamp,
        media_type = EXCLUDED.media_type,
        caption = EXCLUDED.caption,
        likes = EXCLUDED.likes,
        comments = EXCLUDED.comments,
        reach = EXCLUDED.reach,
        impressions = EXCLUDED.impressions,
        saved = EXCLUDED.saved,
        shares = EXCLUDED.shares,
        link_clicks = EXCLUDED.link_clicks,
        thumbnail_url = EXCLUDED.thumbnail_url,
        media_url = EXCLUDED.media_url,
        permalink = EXCLUDED.permalink,
        synced_at = EXCLUDED.synced_at`,
        [
          clientId,
          item.id,
          ts,
          item.media_type ?? "IMAGE",
          item.caption ?? "",
          likes,
          comments,
          metrics.reach ?? 0,
          0,
          metrics.saved ?? 0,
          metrics.shares ?? 0,
          linkClicks,
          item.thumbnail_url ?? null,
          item.media_url ?? null,
          item.permalink ?? null,
          syncedAt
        ]
      );
      if ((i + 1) % 25 === 0) {
        console.log(`[posts] processed ${i + 1}/${media.length}`);
      }
    }

    console.log(`[insights] start. since=${since} until=${until}`);

    const reachMetrics = await fetchReachByWindows(igUserId, accessToken, since, until, clientId);
    const followerMetrics = await fetchFollowerCountRecent(igUserId, accessToken, until, clientId);
    const accountInsights = [...reachMetrics, ...followerMetrics];

    const byDate = new Map();

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
        await pool.query(
          `INSERT INTO account_insights_cache (
          client_id,
          date,
          followers,
          reach,
          impressions,
          profile_views,
          website_clicks
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (client_id, date) DO UPDATE SET
          followers = EXCLUDED.followers,
          reach = EXCLUDED.reach,
          impressions = EXCLUDED.impressions,
          profile_views = EXCLUDED.profile_views,
          website_clicks = EXCLUDED.website_clicks`,
          [
            clientId,
            date,
            values.followers,
            values.reach,
            values.impressions,
            values.profileViews,
            values.websiteClicks
          ]
        );
      }
      console.log(`[insights] upserted ${byDate.size} days`);
    } catch (err) {
      console.error("ERRO no processamento de insights da conta:", err);
      throw err;
    }
  } finally {
    console.log(`[sync] done client=${clientId}`);
    console.timeEnd(`sync:${clientId}`);
  }
}

module.exports = {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  getFacebookPages,
  getInstagramBusinessAccount,
  sumStoryImpressionsAsViews,
  fetchInstagramStories,
  syncInstagramForClient
};
