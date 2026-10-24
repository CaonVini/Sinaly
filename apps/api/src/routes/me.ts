import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { onboardingSchema } from "@sinaly/shared";
import { db } from "../db/client.js";
import { isUniqueViolation, pgError } from "../db/errors.js";
import { citizenProfiles, users } from "../db/schema.js";
import { encrypt, hashCpf } from "../security/crypto.js";

export async function meRoutes(app: FastifyInstance) {
  app.get("/me", { preHandler: app.authenticate }, async (req) => {
    const [row] = await db
      .select({ id: users.id, email: users.email, role: users.role, name: users.name, profile: citizenProfiles.userId })
      .from(users)
      .leftJoin(citizenProfiles, eq(citizenProfiles.userId, users.id))
      .where(eq(users.id, req.auth.userId));
    return { id: row!.id, email: row!.email, role: row!.role, name: row!.name, onboardingComplete: row!.profile !== null };
  });

  // Onboarding do cidadão: nome, sobrenome, telefone, CPF e endereço. Uma única vez.
  app.post("/me/onboarding", { preHandler: app.requireRole("cidadao") }, async (req, reply) => {
    const parsed = onboardingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    const d = parsed.data;
    try {
      await db.transaction(async (tx) => {
        await tx.insert(citizenProfiles).values({
          userId: req.auth.userId,
          firstName: d.firstName,
          lastName: d.lastName,
          phone: d.phone,
          cpfHash: hashCpf(d.cpf),
          cpfEnc: encrypt(d.cpf),
          cep: d.address.cep,
          street: d.address.street,
          number: d.address.number,
          complement: d.address.complement,
          neighborhood: d.address.neighborhood,
          city: d.address.city,
          state: d.address.state,
        });
        await tx.update(users).set({ name: `${d.firstName} ${d.lastName}` }).where(eq(users.id, req.auth.userId));
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const dupCpf = (pgError(e).constraint ?? "").includes("cpf");
        return reply.code(409).send({ error: dupCpf ? "CPF já cadastrado" : "Onboarding já concluído" });
      }
      throw e;
    }
    return reply.code(201).send({ onboardingComplete: true });
  });
}
