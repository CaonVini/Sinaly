import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
});

// Falha cedo e com mensagem clara se faltar variável de ambiente.
export const env = schema.parse(process.env);
