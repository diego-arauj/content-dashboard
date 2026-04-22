import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric, formatPercent } from "@/lib/utils";

type OverviewMetricsProps = {
  followers: number;
  averageReach: number;
  engagementRate: number;
  /** Quantidade de posts no período selecionado */
  postsInPeriod: number;
};

export function OverviewMetrics({
  followers,
  averageReach,
  engagementRate,
  postsInPeriod
}: OverviewMetricsProps) {
  const items = [
    { label: "Seguidores", value: formatMetric(followers) },
    { label: "Alcance médio", value: formatMetric(Math.round(averageReach)) },
    { label: "Engajamento médio", value: formatPercent(engagementRate) },
    { label: "Posts no período", value: formatMetric(postsInPeriod) }
  ];

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-600">{item.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight">{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
