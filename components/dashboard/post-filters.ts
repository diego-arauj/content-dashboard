export type PostSortKey = "engagement" | "reach" | "likes" | "comments" | "shares" | "saves";
export type PostFormatFilter = "all" | "IMAGE" | "CAROUSEL_ALBUM" | "VIDEO";

export const SORT_LABELS: Record<PostSortKey, string> = {
  engagement: "Engajamento",
  reach: "Alcance",
  likes: "Curtidas",
  comments: "Comentários",
  shares: "Compartilhamentos",
  saves: "Salvamentos"
};

export const FORMAT_LABELS: Record<PostFormatFilter, string> = {
  all: "Todos",
  IMAGE: "Imagem",
  CAROUSEL_ALBUM: "Carrossel",
  VIDEO: "Reel"
};
