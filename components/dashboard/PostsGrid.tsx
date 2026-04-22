"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatMetric } from "@/lib/utils";
import {
  FORMAT_LABELS,
  type PostFormatFilter,
  type PostSortKey,
  SORT_LABELS
} from "./post-filters";

export type DashboardPost = {
  id: string;
  timestamp: string;
  media_type: string | null;
  likes: number;
  comments: number;
  reach: number;
  saved: number;
  shares: number;
  thumbnail_url: string | null;
  media_url: string | null;
  permalink: string | null;
};

function postImageSrc(post: DashboardPost): string {
  const fallback = "https://placehold.co/600x600/f5f5f5/111111?text=Post";
  if (post.media_type === "VIDEO") return post.thumbnail_url ?? fallback;
  if (post.media_type === "IMAGE" || post.media_type === "CAROUSEL_ALBUM")
    return post.media_url ?? post.thumbnail_url ?? fallback;
  return post.media_url ?? post.thumbnail_url ?? fallback;
}

type PostsGridProps = {
  posts: DashboardPost[];
  sortBy: PostSortKey;
  onSortChange: (value: PostSortKey) => void;
  formatFilter: PostFormatFilter;
  onFormatChange: (value: PostFormatFilter) => void;
};

const SORT_KEYS = Object.keys(SORT_LABELS) as PostSortKey[];
const FORMAT_KEYS = Object.keys(FORMAT_LABELS) as PostFormatFilter[];

export function PostsGrid({ posts, sortBy, onSortChange, formatFilter, onFormatChange }: PostsGridProps) {
  return (
    <Card className="dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
      <CardHeader className="space-y-4">
        <CardTitle className="text-lg dark:text-[#f0f0f0]">Posts recentes</CardTitle>
        <div className="space-y-3">
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">Ordenar por</p>
            <div className="flex flex-wrap gap-2">
              {SORT_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSortChange(key)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                    sortBy === key
                      ? "border-[#111] bg-[#111] text-white dark:border-[#f0f0f0] dark:bg-[#f0f0f0] dark:text-[#111]"
                      : "border-[#E5E5E5] bg-white text-neutral-700 hover:bg-[#F5F5F5] dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-neutral-300 dark:hover:bg-[#252525]"
                  )}
                >
                  {SORT_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">Formato</p>
            <div className="flex flex-wrap gap-2">
              {FORMAT_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onFormatChange(key)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                    formatFilter === key
                      ? "border-[#111] bg-[#111] text-white dark:border-[#f0f0f0] dark:bg-[#f0f0f0] dark:text-[#111]"
                      : "border-[#E5E5E5] bg-white text-neutral-700 hover:bg-[#F5F5F5] dark:border-[#2a2a2a] dark:bg-[#1a1a1a] dark:text-neutral-300 dark:hover:bg-[#252525]"
                  )}
                >
                  {FORMAT_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <a
              key={post.id}
              href={post.permalink ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="group relative overflow-hidden rounded-lg border border-[#E5E5E5] dark:border-[#2a2a2a]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={postImageSrc(post)} alt="Post do Instagram" className="h-72 w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-black/70 p-3 text-xs text-white opacity-0 transition group-hover:opacity-100">
                <div className="flex justify-between">
                  <span>Likes {formatMetric(post.likes)}</span>
                  <span>Comentários {formatMetric(post.comments)}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span>Alcance {formatMetric(post.reach)}</span>
                  <span>Salvos {formatMetric(post.saved)}</span>
                </div>
                <div className="mt-1">
                  <span>Compart. {formatMetric(post.shares)}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
