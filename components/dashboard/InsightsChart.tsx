"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric } from "@/lib/utils";

type InsightsChartProps = {
  data: Array<{ date: string; reach: number; impressions: number; websiteClicks: number }>;
};

export function InsightsChart({ data }: InsightsChartProps) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const gridColor = isDark ? "#2a2a2a" : "#E5E5E5";
  const tickColor = isDark ? "#a0a0a0" : "#6B7280";
  const lineColor = isDark ? "#f0f0f0" : "#111111";
  const tooltipBg = isDark ? "#1a1a1a" : "#ffffff";
  const tooltipBorder = isDark ? "#2a2a2a" : "#E5E5E5";

  return (
    <Card className="dark:border-[#2a2a2a] dark:bg-[#1a1a1a]">
      <CardHeader>
        <CardTitle className="text-lg dark:text-[#f0f0f0]">Evolução de alcance e impressões</CardTitle>
      </CardHeader>
      <CardContent className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => format(new Date(value), "dd/MM", { locale: ptBR })}
              tick={{ fontSize: 12, fill: tickColor }}
              axisLine={{ stroke: gridColor }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value) => formatMetric(value)}
              tick={{ fontSize: 12, fill: tickColor }}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: number) => formatMetric(value)}
              labelFormatter={(value: string) => format(new Date(value), "dd 'de' MMM", { locale: ptBR })}
              contentStyle={{
                border: `1px solid ${tooltipBorder}`,
                borderRadius: "0.5rem",
                backgroundColor: tooltipBg,
                color: isDark ? "#f0f0f0" : "#111111"
              }}
            />
            <Line type="monotone" dataKey="reach" stroke={lineColor} strokeWidth={2} dot={false} name="Alcance" />
            <Line
              type="monotone"
              dataKey="impressions"
              stroke="#6B7280"
              strokeWidth={2}
              dot={false}
              name="Impressões"
            />
            <Line
              type="monotone"
              dataKey="websiteClicks"
              stroke="#3B82F6"
              strokeWidth={2}
              dot={false}
              name="Cliques no site"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
