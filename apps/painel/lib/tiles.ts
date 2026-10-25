import type * as Leaflet from "leaflet";
import type { ServiceArea } from "@sinaly/shared";

/**
 * Base do mapa: CARTO Voyager (dados do OpenStreetMap), visual limpo e próximo do Google Maps do app,
 * sem chave de API. Tiles @2x em telas de alta densidade. Para trocar de provedor, mude só aqui e no CSP (next.config.ts).
 * Uso gratuito da CARTO tem limite de volume; para produção em escala, contrate o plano ou hospede tiles próprios.
 */
export function addBaseLayer(L: typeof Leaflet, map: Leaflet.Map) {
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
    detectRetina: false,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
    referrerPolicy: "origin",
  }).addTo(map);
}

/**
 * Trava o mapa na área de atuação (com 15% de folga): não arrasta para fora nem afasta além da cidade.
 * Sem área, libera. Devolve os limites para quem quiser enquadrar a visão inicial.
 */
export function lockToArea(L: typeof Leaflet, map: Leaflet.Map, area: ServiceArea | null | undefined): Leaflet.LatLngBounds | null {
  if (!area) {
    map.setMaxBounds(null as unknown as Leaflet.LatLngBounds);
    map.setMinZoom(0);
    return null;
  }
  const [w, s, e, n] = area.bbox;
  const bounds = L.latLngBounds([s, w], [n, e]);
  const padded = bounds.pad(0.15);
  map.options.maxBoundsViscosity = 1;
  map.setMaxBounds(padded);
  map.setMinZoom(Math.max(0, map.getBoundsZoom(padded) - 0));
  return bounds;
}
