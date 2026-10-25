import { eq } from "drizzle-orm";
import { serviceAreaSchema, type ServiceArea } from "@sinaly/shared";
import { db } from "./db/client.js";
import { appSettings } from "./db/schema.js";
import { env } from "./env.js";

const TTL_MS = 5_000;
let cache: { at: number; geocoder: boolean; area: ServiceArea | null } | null = null;

/** Padrão do .env ("Nome|oeste,sul,leste,norte"); inválido ou vazio = sem limite. */
function envArea(): ServiceArea | null {
  const [name, coords] = env.SERVICE_AREA_DEFAULT.split("|");
  if (!name || !coords) return null;
  const r = serviceAreaSchema.safeParse({ name, bbox: coords.split(",").map(Number) });
  return r.success ? r.data : null;
}

async function load() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const rows = await db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings);
  const get = (k: string) => rows.find((r) => r.key === k);
  const geo = get("geocoder_enabled");
  const area = get("service_area");
  // Linha gravada ({ area }) vale sempre, inclusive area = null ("sem limite", escolhido pelo admin); sem linha, padrão do .env.
  let current = envArea();
  if (area) {
    const v = (area.value as { area?: unknown }).area;
    const parsed = v === null ? null : serviceAreaSchema.safeParse(v);
    current = parsed === null ? null : parsed.success ? parsed.data : current;
  }
  cache = { at: Date.now(), geocoder: geo ? geo.value !== false : true, area: current };
  return cache;
}

/** Bairro automático ligado? Padrão: ligado (sem linha no banco). Cache curto; a escrita invalida. */
export async function geocoderSetting(): Promise<boolean> {
  return (await load()).geocoder;
}

/** Área de atuação atual (null = sem limite). */
export async function serviceArea(): Promise<ServiceArea | null> {
  return (await load()).area;
}

export const invalidateSettings = () => {
  cache = null;
};
