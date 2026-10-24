// O Drizzle embrulha o erro do driver em DrizzleQueryError; o código do Postgres fica em `cause`.
type PgLike = { code?: string; constraint?: string; cause?: PgLike };

export function pgError(e: unknown): { code?: string; constraint?: string } {
  const err = e as PgLike;
  return { code: err.code ?? err.cause?.code, constraint: err.constraint ?? err.cause?.constraint };
}

export const isUniqueViolation = (e: unknown) => pgError(e).code === "23505";
