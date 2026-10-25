import Constants from "expo-constants";

/**
 * Endereço da API, nesta ordem:
 *  1. EXPO_PUBLIC_API_URL (produção, túnel ou IP fixo). Ex.: https://api.sinaly.com.br
 *  2. Em desenvolvimento com Expo Go: o mesmo IP do PC que roda o `expo start`, na porta 3333.
 *     O celular já alcança esse IP (é de onde ele baixa o app), então a API costuma funcionar sem configurar nada.
 *  3. localhost (só serve no navegador/emulador do próprio PC).
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (__DEV__ && host) return `http://${host}:3333`;
  return "http://localhost:3333";
}

export const API_URL = resolveApiUrl();

/** Centro inicial do mapa antes do GPS responder: EXPO_PUBLIC_DEFAULT_CENTER="lat,lng" ou o centro do Brasil. */
function resolveCenter(): { lat: number; lng: number; zoom: number } {
  const raw = process.env.EXPO_PUBLIC_DEFAULT_CENTER?.split(",").map(Number);
  if (raw && raw.length === 2 && raw.every(Number.isFinite) && Math.abs(raw[0]!) <= 90 && Math.abs(raw[1]!) <= 180) {
    return { lat: raw[0]!, lng: raw[1]!, zoom: 14 };
  }
  return { lat: -14.2, lng: -51.9, zoom: 4 };
}

export const DEFAULT_CENTER = resolveCenter();
