import Link from "next/link";
import { differenceInDays } from "date-fns";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { accountInsightsCache, clients, instagramAccounts, postsCache } from "@/db/schema";
import {
  ClientDashboard,
  type DashboardInsightRow,
  type DashboardPostRow
} from "@/components/dashboard/ClientDashboard";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ClientDashboardPage({
  params
}: PageProps<"/dashboard/[clientId]">) {
  const { clientId } = await params;

  const [client] = await db
    .select({
      id: clients.id,
      name: clients.name,
      niche: clients.niche,
      username: instagramAccounts.username,
      tokenExpiresAt: instagramAccounts.tokenExpiresAt,
      followersCount: instagramAccounts.followersCount,
      profilePictureUrl: instagramAccounts.profilePictureUrl
    })
    .from(clients)
    .leftJoin(instagramAccounts, eq(instagramAccounts.clientId, clients.id))
    .where(eq(clients.id, clientId));

  if (!client) {
    notFound();
  }

  const username = client.username ?? null;
  if (!username) {
    return (
      <main className="min-h-screen bg-[#F5F5F5] px-6 py-10">
        <div className="mx-auto max-w-4xl rounded-xl border border-[#E5E5E5] bg-white p-10 shadow-subtle">
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          <p className="mt-2 text-neutral-600">Este cliente ainda não conectou uma conta do Instagram.</p>
          <Button asChild className="mt-6">
            <Link href={`/dashboard/${clientId}/onboarding`}>Conectar Instagram</Link>
          </Button>
        </div>
      </main>
    );
  }

  const postsData = await db
    .select({
      id: postsCache.id,
      timestamp: postsCache.timestamp,
      likes: postsCache.likes,
      comments: postsCache.comments,
      reach: postsCache.reach,
      saved: postsCache.saved,
      shares: postsCache.shares,
      linkClicks: postsCache.linkClicks,
      mediaType: postsCache.mediaType,
      thumbnail_url: postsCache.thumbnailUrl,
      media_url: postsCache.mediaUrl,
      permalink: postsCache.permalink
    })
    .from(postsCache)
    .where(eq(postsCache.clientId, clientId));

  const insightsData = await db
    .select({
      date: accountInsightsCache.date,
      followers: accountInsightsCache.followers,
      reach: accountInsightsCache.reach,
      impressions: accountInsightsCache.impressions,
      profileViews: accountInsightsCache.profileViews,
      websiteClicks: accountInsightsCache.websiteClicks
    })
    .from(accountInsightsCache)
    .where(eq(accountInsightsCache.clientId, clientId))
    .orderBy(asc(accountInsightsCache.date));

  const posts: DashboardPostRow[] = postsData.map((row) => ({
    id: row.id,
    timestamp: row.timestamp ? row.timestamp.toISOString() : null,
    likes: row.likes,
    comments: row.comments,
    reach: row.reach,
    saved: row.saved,
    shares: row.shares,
    link_clicks: row.linkClicks,
    media_type: row.mediaType,
    thumbnail_url: row.thumbnail_url,
    media_url: row.media_url,
    permalink: row.permalink
  }));

  const insights: DashboardInsightRow[] = insightsData.map((row) => ({
    date: row.date,
    followers: row.followers,
    reach: row.reach,
    impressions: row.impressions,
    profileViews: row.profileViews,
    websiteClicks: row.websiteClicks
  }));

  const expiresAt = client.tokenExpiresAt;
  const expiringSoon = expiresAt ? differenceInDays(new Date(expiresAt), new Date()) < 7 : false;

  return (
    <ClientDashboard
      clientId={clientId}
      clientName={client.name}
      username={username}
      niche={client.niche}
      expiringSoon={expiringSoon}
      followersCount={client.followersCount}
      profilePictureUrl={client.profilePictureUrl}
      insights={insights}
      posts={posts}
    />
  );
}
