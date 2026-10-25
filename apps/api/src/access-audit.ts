import type { FastifyRequest } from "fastify";
import type { Auth } from "./auth.js";
import { db } from "./db/client.js";
import { accessAudit } from "./db/schema.js";

type Tx = Pick<typeof db, "insert">;

/**
 * Registra acesso a dado pessoal (LGPD). Quem chama dá `await` ANTES de devolver os dados:
 * se a gravação falhar, a requisição falha (500) e nada é entregue sem registro.
 */
export async function auditAccess(
  req: FastifyRequest,
  entry: { action: string; subjectType?: string; subjectId?: string; details?: Record<string, unknown> },
  tx: Tx = db,
  actor: Auth = req.auth,
) {
  await tx.insert(accessAudit).values({
    actorId: actor.userId,
    actorRole: actor.role,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    details: entry.details ?? {},
    ip: req.ip,
    userAgent: req.headers["user-agent"]?.slice(0, 255),
  });
}
