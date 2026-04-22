"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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
  data: Array<{ date: string; reach: number; impressions: number }>;
};

export function InsightsChart({ data }: InsightsChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Evolução de alcance e impressões</CardTitle>
      </CardHeader>
      <CardContent className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="#E5E5E5" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => format(new Date(value), "dd/MM", { locale: ptBR })}
              tick={{ fontSize: 12 }}
              axisLine={{ stroke: "#D4D4D4" }}
              tickLine={false}
            />
            <YAxis tickFormatter={(value) => formatMetric(value)} tick={{ fontSize: 12 }} tickLine={false} />
            <Tooltip
              formatter={(value: number) => formatMetric(value)}
              labelFormatter={(value: string) => format(new Date(value), "dd 'de' MMM", { locale: ptBR })}
              contentStyle={{
                border: "1px solid #E5E5E5",
                borderRadius: "0.5rem",
                boxShadow: "0 1px 2px rgba(17,17,17,0.06)"
              }}
            />
            <Line type="monotone" dataKey="reach" stroke="#111111" strokeWidth={2} dot={false} name="Alcance" />
            <Line
              type="monotone"
              dataKey="impressions"
              stroke="#6B7280"
              strokeWidth={2}
              dot={false}
              name="Impressões"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
