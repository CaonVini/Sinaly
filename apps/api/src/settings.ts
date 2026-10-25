import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { appSettings } from "./db/schema.js";

const TTL_MS = 5_000;
let cache: { at: number; geocoder: boolean } | null = null;

/** Bairro automático ligado? Padrão: ligado (sem linha no banco). Cache curto; a escrita invalida. */
export async function geocoderSetting(): Promise<boolean> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.geocoder;
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "geocoder_enabled"));
  cache = { at: Date.now(), geocoder: row ? row.value !== false : true };
  return cache.geocoder;
}
export const invalidateSettings = () => {
  cache = null;
};
