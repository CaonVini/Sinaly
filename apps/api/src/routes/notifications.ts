import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { notificationsQuerySchema } from "@sinaly/shared";
import { db } from "../db/client.js";
import { notifications } from "../db/schema.js";
import { decodeCursor, encodeCursor, HttpError, parse, UUID_RE } from "../http.js";

// Notificações dentro do app (o cliente consulta). Push/e-mail em tempo real ficam fora do MVP.
export async function notificationRoutes(app: FastifyInstance) {
  app.get("/me/notifications", { preHandler: app.authenticate }, async (req) => {
    const q = parse(notificationsQuerySchema, req.query);
    const userId = req.auth.userId;
    const c = decodeCursor(q.cursor);
    const cursorTs = sql<string>`to_char(${notifications.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const rows = await db
      .select({
        id: notifications.id,
        occurrenceId: notifications.occurrenceId,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        fromStatus: notifications.fromStatus,
        toStatus: notifications.toStatus,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        cursorTs,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          q.unread ? isNull(notifications.readAt) : undefined,
          c ? sql`(${notifications.createdAt}, ${notifications.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit);
    const last = items.at(-1);
    const [unread] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return {
      items: items.map(({ cursorTs: _c, ...r }) => r),
      unreadCount: unread?.n ?? 0,
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.cursorTs, last.id) : null,
    };
  });

  app.post("/me/notifications/read-all", { preHandler: app.authenticate }, async (req) => {
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, req.auth.userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { updated: updated.length };
  });

  // "Limpar avisos": apaga só as notificações do próprio usuário. Não toca no histórico da ocorrência (auditoria).
  app.delete("/me/notifications", { preHandler: app.authenticate }, async (req) => {
    const removed = await db.delete(notifications).where(eq(notifications.userId, req.auth.userId)).returning({ id: notifications.id });
    return { removed: removed.length };
  });

  app.post("/me/notifications/:id/read", { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!UUID_RE.test(id)) throw new HttpError(404, "Notificação não encontrada");
    // Filtra pelo dono na própria consulta: ninguém marca a notificação de outra pessoa.
    const done = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, req.auth.userId)))
      .returning({ id: notifications.id });
    if (done.length === 0) throw new HttpError(404, "Notificação não encontrada");
    return reply.code(204).send();
  });
}
