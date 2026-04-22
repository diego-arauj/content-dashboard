import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric } from "@/lib/utils";
import { SORT_LABELS, type PostSortKey } from "./post-filters";

const PLACEHOLDER_POST = "https://placehold.co/200x200/f5f5f5/111111?text=Post";

type TopPost = {
  id: string;
  likes: number;
  comments: number;
  reach: number;
  saved: number;
  shares: number;
  mediaType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
};

type TopPostsProps = {
  posts: TopPost[];
  sortKey: PostSortKey;
};

function topPostThumbSrc(post: TopPost): string | null {
  if (post.mediaType === "VIDEO") return post.thumbnailUrl ?? null;
  if (post.mediaType === "IMAGE" || post.mediaType === "CAROUSEL_ALBUM") return post.mediaUrl ?? null;
  return post.mediaUrl ?? post.thumbnailUrl ?? null;
}

function engagementTotal(post: TopPost) {
  return post.likes + post.comments + post.saved + post.shares;
}

export function TopPosts({ posts, sortKey }: TopPostsProps) {
  const sortLabel = SORT_LABELS[sortKey].toLowerCase();
  return (
    <Card className="dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
      <CardHeader>
        <CardTitle className="text-lg dark:text-[#f0f0f0]">Top 5 posts por {sortLabel}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {posts.map((post, index) => {
          const thumb = topPostThumbSrc(post) ?? PLACEHOLDER_POST;
          return (
            <a
              key={post.id}
              href={post.permalink ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-lg border border-[#E5E5E5] p-3 dark:border-[#2a2a2a] dark:hover:bg-[#252525]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb} alt={`Top post ${index + 1}`} className="h-14 w-14 shrink-0 rounded-md object-cover" />
              <div className="flex-1">
                <p className="text-sm font-semibold dark:text-[#f0f0f0]">Post #{index + 1}</p>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-600 dark:text-neutral-400">
                  <span>Engajamento {formatMetric(engagementTotal(post))}</span>
                  <span>Alcance {formatMetric(post.reach)}</span>
                  <span>Salvos {formatMetric(post.saved)}</span>
                  <span>Compart. {formatMetric(post.shares)}</span>
                </div>
              </div>
            </a>
          );
        })}
      </CardContent>
    </Card>
  );
}
