import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  // Atrás de proxy (Caddy/Nginx) para req.ip refletir o cliente real e não o proxy.
  // Pasta das fotos (volume Docker em produção). Troque storage.ts por S3/R2 quando escalar.
  UPLOAD_DIR: z.string().default("./data/uploads"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // Segredos: gere com `openssl rand -base64 48` (JWT/pepper) e `openssl rand -base64 32` (chave).
  JWT_SECRET: z.string().min(32),
  CPF_HASH_PEPPER: z.string().min(32),
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "Deve ser 32 bytes em base64"),
});

// Falha cedo e com mensagem clara se faltar variável de ambiente.
export const env = schema.parse(process.env);
