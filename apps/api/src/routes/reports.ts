import { and, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { reportQuerySchema } from "@sinaly/shared";
import { db } from "../db/client.js";
import { parse } from "../http.js";

const TZ = "America/Sao_Paulo";
const NO_NEIGHBORHOOD = "Sem bairro";

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

export async function reportRoutes(app: FastifyInstance) {
  const staffOnly = app.requireRole("servidor", "gestor", "admin");

  // Relatórios agregados (somente números; sem dados pessoais). Filtros: período, categoria e status.
  app.get("/staff/reports", { preHandler: staffOnly }, async (req) => {
    const q = parse(reportQuerySchema, req.query);
    const where: SQL = and(
      q.from ? sql`o.created_at >= (${q.from}::date)::timestamp at time zone ${TZ}` : undefined,
      q.to ? sql`o.created_at < ((${q.to}::date + 1)::timestamp at time zone ${TZ})` : undefined,
      q.category ? sql`o.category = ${q.category}` : undefined,
      q.status ? sql`o.status = ${q.status}` : undefined,
    ) ?? sql`true`;

    // Dia a dia em períodos de até ~3 meses; senão, mês a mês (limita o tamanho da resposta).
    const days = q.from && q.to ? (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 + 1 : Infinity;
    const grain = days <= 92 ? "day" : "month";

    // "Resolvida" = status do tipo resolved; tempo = resolved_at - created_at, em horas.
    const isResolved = sql`(s.kind = 'resolved' and o.resolved_at is not null)`;
    const hours = sql`extract(epoch from (o.resolved_at - o.created_at)) / 3600`;
    const base = sql`from occurrences o join statuses s on s.slug = o.status where ${where}`;

    const [totals, byNeighborhood, byCategory, byStatus, byPeriod, buckets] = await Promise.all([
      db.execute(sql`select count(*)::int as total,
          count(*) filter (where ${isResolved})::int as resolved,
          count(*) filter (where s.kind in ('initial', 'active'))::int as open,
          count(*) filter (where s.kind = 'rejected')::int as rejected,
          count(*) filter (where o.neighborhood is null)::int as no_neighborhood,
          avg(${hours}) filter (where ${isResolved})::float8 as avg_hours,
          (percentile_cont(0.5) within group (order by ${hours}) filter (where ${isResolved}))::float8 as median_hours
        ${base}`),
      db.execute(sql`select coalesce(o.neighborhood, ${NO_NEIGHBORHOOD}) as key, count(*)::int as total,
          count(*) filter (where ${isResolved})::int as resolved,
          count(*) filter (where s.kind in ('initial', 'active'))::int as open,
          avg(${hours}) filter (where ${isResolved})::float8 as avg_hours
        ${base} group by 1 order by total desc, key limit 200`),
      db.execute(sql`select o.category as key, count(*)::int as total,
          count(*) filter (where ${isResolved})::int as resolved,
          count(*) filter (where s.kind in ('initial', 'active'))::int as open,
          avg(${hours}) filter (where ${isResolved})::float8 as avg_hours
        ${base} group by 1 order by total desc, key`),
      db.execute(sql`select o.status as key, count(*)::int as total ${base} group by 1 order by total desc, key`),
      db.execute(sql`select to_char(date_trunc(${grain}, o.created_at at time zone ${TZ}), ${grain === "day" ? "YYYY-MM-DD" : "YYYY-MM"}) as key,
          count(*)::int as total, count(*) filter (where ${isResolved})::int as resolved
        ${base} group by 1 order by 1`),
      db.execute(sql`select
          count(*) filter (where ${hours} < 24)::int as lt_1d,
          count(*) filter (where ${hours} >= 24 and ${hours} < 72)::int as d1_3,
          count(*) filter (where ${hours} >= 72 and ${hours} < 168)::int as d3_7,
          count(*) filter (where ${hours} >= 168)::int as gt_7d
        ${base} and ${isResolved}`),
    ]);

    const t = (totals.rows[0] ?? {}) as Row;
    const withHours = (r: Row) => ({ ...r, avg_hours: undefined, avgHours: num(r.avg_hours) });
    const b = (buckets.rows[0] ?? {}) as Row;
    return {
      grain,
      totals: {
        total: Number(t.total ?? 0),
        resolved: Number(t.resolved ?? 0),
        open: Number(t.open ?? 0),
        rejected: Number(t.rejected ?? 0),
        noNeighborhood: Number(t.no_neighborhood ?? 0),
        avgResolutionHours: num(t.avg_hours),
        medianResolutionHours: num(t.median_hours),
      },
      byNeighborhood: byNeighborhood.rows.map(withHours),
      byCategory: byCategory.rows.map(withHours),
      byStatus: byStatus.rows,
      byPeriod: byPeriod.rows,
      resolutionBuckets: { lt1d: Number(b.lt_1d ?? 0), d1to3: Number(b.d1_3 ?? 0), d3to7: Number(b.d3_7 ?? 0), gt7d: Number(b.gt_7d ?? 0) },
    };
  });
}
