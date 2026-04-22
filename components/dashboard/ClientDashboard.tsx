"use client";

import Link from "next/link";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { InsightsChart } from "@/components/dashboard/InsightsChart";
import { OverviewMetrics } from "@/components/dashboard/OverviewMetrics";
import { PostsGrid } from "@/components/dashboard/PostsGrid";
import { TopPosts } from "@/components/dashboard/TopPosts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMetric } from "@/lib/utils";
import type { PostFormatFilter, PostSortKey } from "@/components/dashboard/post-filters";

export type DashboardInsightRow = {
  date: string | null;
  followers: number | null;
  reach: number | null;
  impressions: number | null;
  profileViews: number | null;
};

export type DashboardPostRow = {
  id: string;
  timestamp: string | null;
  likes: number | null;
  comments: number | null;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  link_clicks: number | null;
  media_type: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  permalink: string | null;
};

type ClientDashboardProps = {
  clientId: string;
  clientName: string;
  username: string;
  niche: string | null;
  expiringSoon: boolean;
  followersCount: number | null;
  profilePictureUrl: string | null;
  insights: DashboardInsightRow[];
  posts: DashboardPostRow[];
};

function dateStrToBoundaryMs(dateStr: string, endOfDay: boolean) {
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  return new Date(`${dateStr}${suffix}`).getTime();
}

function filterInsightsByRange(
  rows: DashboardInsightRow[],
  fromStr: string,
  toStr: string
): DashboardInsightRow[] {
  return rows
    .filter((row) => {
      const d = row.date;
      if (!d) return false;
      return d >= fromStr && d <= toStr;
    })
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

function filterPostsByRange(posts: DashboardPostRow[], fromStr: string, toStr: string): DashboardPostRow[] {
  const fromMs = dateStrToBoundaryMs(fromStr, false);
  const toMs = dateStrToBoundaryMs(toStr, true);
  return posts.filter((post) => {
    if (!post.timestamp) return false;
    const t = new Date(post.timestamp).getTime();
    return t >= fromMs && t <= toMs;
  });
}

function engagementScore(p: DashboardPostRow) {
  return (p.likes ?? 0) + (p.comments ?? 0) + (p.saved ?? 0) + (p.shares ?? 0);
}

function comparePosts(a: DashboardPostRow, b: DashboardPostRow, sort: PostSortKey): number {
  switch (sort) {
    case "engagement":
      return engagementScore(b) - engagementScore(a);
    case "reach":
      return (b.reach ?? 0) - (a.reach ?? 0);
    case "likes":
      return (b.likes ?? 0) - (a.likes ?? 0);
    case "comments":
      return (b.comments ?? 0) - (a.comments ?? 0);
    case "shares":
      return (b.shares ?? 0) - (a.shares ?? 0);
    case "saves":
      return (b.saved ?? 0) - (a.saved ?? 0);
    case "link_clicks":
      return (b.link_clicks ?? 0) - (a.link_clicks ?? 0);
    default:
      return 0;
  }
}

function matchesFormat(mediaType: string | null, format: PostFormatFilter): boolean {
  if (format === "all") return true;
  return mediaType === format;
}

export function ClientDashboard({
  clientId,
  clientName,
  username,
  niche,
  expiringSoon,
  followersCount,
  profilePictureUrl,
  insights,
  posts
}: ClientDashboardProps) {
  const router = useRouter();
  const defaultTo = format(new Date(), "yyyy-MM-dd");
  const defaultFrom = format(subDays(new Date(), 29), "yyyy-MM-dd");

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [syncing, setSyncing] = useState(false);
  const [sortBy, setSortBy] = useState<PostSortKey>("engagement");
  const [formatFilter, setFormatFilter] = useState<PostFormatFilter>("all");
  const skipSyncRef = useRef(true);

  const runSync = useCallback(
    async (from: string, to: string) => {
      const since = Math.floor(dateStrToBoundaryMs(from, false) / 1000);
      const until = Math.floor(dateStrToBoundaryMs(to, true) / 1000);
      setSyncing(true);
      try {
        const res = await fetch(
          `/api/instagram/sync/${clientId}?since=${since}&until=${until}&redirect=false`,
          { method: "GET" }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Falha ao sincronizar.");
        }
        router.refresh();
      } finally {
        setSyncing(false);
      }
    },
    [clientId, router]
  );

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void runSync(dateFrom, dateTo);
    }, 900);
    return () => window.clearTimeout(t);
  }, [dateFrom, dateTo, runSync]);

  const filteredInsights = useMemo(
    () => filterInsightsByRange(insights, dateFrom, dateTo),
    [insights, dateFrom, dateTo]
  );

  const postsInRange = useMemo(
    () => filterPostsByRange(posts, dateFrom, dateTo),
    [posts, dateFrom, dateTo]
  );

  const postsAfterFormat = useMemo(
    () => postsInRange.filter((p) => matchesFormat(p.media_type, formatFilter)),
    [postsInRange, formatFilter]
  );

  const sortedForGrid = useMemo(() => {
    return [...postsAfterFormat].sort((a, b) => comparePosts(a, b, sortBy));
  }, [postsAfterFormat, sortBy]);

  const topFive = useMemo(() => {
    return [...postsAfterFormat].sort((a, b) => comparePosts(a, b, sortBy)).slice(0, 5);
  }, [postsAfterFormat, sortBy]);

  const accountFollowers = followersCount ?? 0;

  const averageReach = postsInRange.length
    ? postsInRange.reduce((acc, post) => acc + (post.reach ?? 0), 0) / postsInRange.length
    : 0;

  const engagementRate =
    accountFollowers > 0 && postsInRange.length
      ? (postsInRange.reduce((acc, post) => acc + (post.likes ?? 0) + (post.comments ?? 0), 0) /
          postsInRange.length /
          accountFollowers) *
        100
      : 0;

  const chartData = useMemo(
    () =>
      filteredInsights
        .filter((item) => item.date)
        .map((item) => ({
          date: item.date as string,
          reach: item.reach ?? 0,
          impressions: item.impressions ?? 0
        })),
    [filteredInsights]
  );

  const gridPosts = useMemo(
    () =>
      sortedForGrid.map((post) => ({
        id: post.id,
        timestamp: post.timestamp ? new Date(post.timestamp).toISOString() : new Date().toISOString(),
        media_type: post.media_type,
        likes: post.likes ?? 0,
        comments: post.comments ?? 0,
        reach: post.reach ?? 0,
        saved: post.saved ?? 0,
        shares: post.shares ?? 0,
        link_clicks: post.link_clicks ?? 0,
        thumbnail_url: post.thumbnail_url,
        media_url: post.media_url,
        permalink: post.permalink
      })),
    [sortedForGrid]
  );

  const topPostItems = useMemo(
    () =>
      topFive.map((post) => ({
        id: post.id,
        likes: post.likes ?? 0,
        comments: post.comments ?? 0,
        reach: post.reach ?? 0,
        saved: post.saved ?? 0,
        shares: post.shares ?? 0,
        link_clicks: post.link_clicks ?? 0,
        mediaType: post.media_type,
        mediaUrl: post.media_url,
        thumbnailUrl: post.thumbnail_url,
        permalink: post.permalink
      })),
    [topFive]
  );

  return (
    <main className="min-h-screen bg-[#F5F5F5] px-6 py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-[#E5E5E5] pb-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            {profilePictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profilePictureUrl}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-[#E5E5E5]"
              />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-full bg-[#E5E5E5]" aria-hidden />
            )}
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{clientName}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-sm text-neutral-600">
                  @{username} {niche ? `· ${niche}` : ""}
                </p>
                {expiringSoon ? <Badge variant="warning">Token expira em menos de 7 dias</Badge> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" asChild>
              <Link href="/dashboard">Voltar</Link>
            </Button>
            <Button
              disabled={syncing}
              onClick={() => void runSync(dateFrom, dateTo)}
              type="button"
            >
              {syncing ? "Sincronizando..." : "Sincronizar agora"}
            </Button>
          </div>
        </header>

        <section className="rounded-xl border border-[#E5E5E5] bg-white p-4 shadow-subtle">
          <p className="text-sm font-medium text-neutral-700">Período</p>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs text-neutral-600">
              Data início
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-md border border-[#E5E5E5] bg-white px-3 py-2 text-sm text-[#111]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-600">
              Data fim
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-md border border-[#E5E5E5] bg-white px-3 py-2 text-sm text-[#111]"
              />
            </label>
            <p className="pb-2 text-xs text-neutral-500">
              Ao alterar as datas, a sincronização com o Instagram é disparada automaticamente.
            </p>
          </div>
        </section>

        <OverviewMetrics
          followers={accountFollowers}
          averageReach={averageReach}
          engagementRate={engagementRate}
          postsInPeriod={postsInRange.length}
        />

        <InsightsChart data={chartData} />

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
          <PostsGrid
            posts={gridPosts}
            sortBy={sortBy}
            onSortChange={setSortBy}
            formatFilter={formatFilter}
            onFormatChange={setFormatFilter}
          />
          <TopPosts posts={topPostItems} sortKey={sortBy} />
        </section>

        <StoriesPanel clientId={clientId} />
      </div>
    </main>
  );
}

type StoryItem = {
  id: string;
  timestamp?: string;
  media_type?: string;
  like_count?: number;
  replies_count?: number;
};

type HistoryRow = {
  date: string;
  totalStories: number | null;
  totalViews: number | null;
};

function StoriesPanel({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resStories = await fetch(`/api/instagram/stories/${clientId}`);
        const dataStories = (await resStories.json()) as { data?: StoryItem[]; error?: string };
        if (!resStories.ok) {
          throw new Error(dataStories.error ?? "Erro ao carregar stories.");
        }
        if (!cancelled) setStories(dataStories.data ?? []);

        const resHist = await fetch(`/api/instagram/stories-history/${clientId}`);
        const dataHist = (await resHist.json()) as { data?: HistoryRow[]; error?: string };
        if (!resHist.ok) {
          throw new Error(dataHist.error ?? "Erro ao carregar histórico.");
        }
        if (!cancelled) setHistory(dataHist.data ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar stories.");
          setStories([]);
          setHistory([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const chartData = useMemo(
    () =>
      history.map((h) => ({
        date: h.date,
        views: h.totalViews ?? 0
      })),
    [history]
  );

  return (
    <section className="space-y-8 rounded-xl border border-[#E5E5E5] bg-white p-6 shadow-subtle">
      <h2 className="text-lg font-semibold">Stories</h2>

      {loading ? (
        <p className="text-sm text-neutral-600">Carregando...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : null}

      {!loading && !error ? (
        <>
          <div>
            <h3 className="text-sm font-medium text-neutral-700">Agora</h3>
            {stories.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">Nenhum story ativo no momento</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-neutral-600">
                  Total: <span className="font-medium text-[#111]">{stories.length}</span>
                </p>
                <ul className="mt-4 space-y-3">
                  {stories.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#F0F0F0] pb-3 text-sm last:border-0 last:pb-0"
                    >
                      <span className="font-mono text-xs text-neutral-500">{s.id}</span>
                      <span className="text-neutral-700">
                        {s.timestamp ? format(new Date(s.timestamp), "dd/MM/yyyy HH:mm") : "—"}
                      </span>
                      <span className="text-xs text-neutral-600">
                        {s.media_type ?? "?"} · curtidas {formatMetric(s.like_count ?? 0)} · respostas{" "}
                        {formatMetric(s.replies_count ?? 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium text-neutral-700">Histórico</h3>
            {chartData.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">Sem registros de histórico ainda.</p>
            ) : (
              <div className="mt-4 h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid stroke="#E5E5E5" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: string) =>
                        format(new Date(v + "T12:00:00"), "dd/MM", { locale: ptBR })
                      }
                    />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatMetric(v)} />
                    <Tooltip
                      formatter={(value: number) => formatMetric(value)}
                      labelFormatter={(label: string) =>
                        format(new Date(label + "T12:00:00"), "dd 'de' MMM yyyy", { locale: ptBR })
                      }
                    />
                    <Bar dataKey="views" fill="#111111" name="Visualizações (impressões)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
