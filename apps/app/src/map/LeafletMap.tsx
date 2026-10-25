import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { Bbox } from "../api";

/**
 * Mapa Leaflet + OpenStreetMap dentro de uma WebView (o mesmo do painel da prefeitura).
 * Por que não react-native-maps: no Android ele exige chave paga do Google Maps para o APK.
 *
 * Segurança: a página só recebe números, ids (uuid) e cores (#RRGGBB) — nunca texto digitado por
 * usuários — então não há como injetar HTML. Leaflet vem do CDN com SRI (hash conferido pelo navegador)
 * e a WebView não navega para nenhum outro endereço.
 */
export type MapMarker = { id: string; lat: number; lng: number; color: string; mine?: boolean };
export type LeafletMapHandle = {
  setMarkers: (m: MapMarker[]) => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  setUserLocation: (lat: number, lng: number) => void;
};
type Props = {
  center: { lat: number; lng: number; zoom: number };
  onRegion?: (bbox: Bbox, center: { lat: number; lng: number }) => void;
  onMarkerPress?: (id: string) => void;
  onMapPress?: () => void;
  onReady?: () => void;
};

export const mapHtml = (c: Props["center"]) => `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://tile.openstreetmap.org data:; style-src https://unpkg.com 'unsafe-inline'; script-src https://unpkg.com 'unsafe-inline'">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<style>html,body,#map{margin:0;height:100%;background:#eef1f7}.leaflet-control-attribution{font-size:10px}</style>
</head><body><div id="map"></div><script>
(function(){
  var post = function(m){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  if (!window.L) { post({type:"error"}); return; }
  var map = L.map("map", { zoomControl:false, preferCanvas:true, attributionControl:true }).setView([${c.lat}, ${c.lng}], ${c.zoom});
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom:19, attribution:"© OpenStreetMap" }).addTo(map);
  map.attributionControl.setPrefix(false);
  var layer = L.layerGroup().addTo(map), me = null;
  var HEX = /^#[0-9a-fA-F]{6}$/, ID = /^[0-9a-f-]{36}$/i;
  var num = function(v){ return typeof v === "number" && isFinite(v); };
  function region(){
    var b = map.getBounds(), c = map.getCenter();
    post({ type:"region", bbox:[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], center:[c.lat, c.lng] });
  }
  window.__sinaly = {
    setMarkers: function(list){
      layer.clearLayers();
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (!m || !ID.test(m.id) || !num(m.lat) || !num(m.lng)) continue;
        var color = HEX.test(m.color) ? m.color : "#667089";
        L.circleMarker([m.lat, m.lng], { radius: m.mine ? 10 : 9, color: m.mine ? "#1b2136" : "#ffffff", weight: m.mine ? 3 : 2,
          dashArray: m.mine ? "4 3" : null, fillColor: color, fillOpacity: 0.95 })
          .on("click", (function(id){ return function(e){ L.DomEvent.stop(e); post({ type:"marker", id:id }); }; })(m.id))
          .addTo(layer);
      }
    },
    flyTo: function(lat, lng, z){ if (num(lat) && num(lng)) map.flyTo([lat, lng], num(z) ? z : Math.max(map.getZoom(), 16), { duration: 0.6 }); },
    setUser: function(lat, lng){
      if (!num(lat) || !num(lng)) return;
      if (!me) me = L.circleMarker([lat, lng], { radius:7, color:"#ffffff", weight:3, fillColor:"#2349d6", fillOpacity:1, interactive:false }).addTo(map);
      else me.setLatLng([lat, lng]);
    }
  };
  map.on("moveend", region);
  map.on("click", function(){ post({ type:"tap" }); });
  map.whenReady(function(){ post({ type:"ready" }); region(); });
})();
</script></body></html>`;

const call = (fn: string, ...args: unknown[]) => `window.__sinaly && window.__sinaly.${fn}(${args.map((a) => JSON.stringify(a)).join(",")}); true;`;

export const LeafletMap = forwardRef<LeafletMapHandle, Props>(function LeafletMap({ center, onRegion, onMarkerPress, onMapPress, onReady }, ref) {
  const web = useRef<WebView<object>>(null);
  // O HTML é montado uma única vez: recriar a página a cada render recarregaria o mapa inteiro.
  const source = useMemo(() => ({ html: mapHtml(center), baseUrl: "https://sinaly.app/" }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    setMarkers: (m) => web.current?.injectJavaScript(call("setMarkers", m)),
    flyTo: (lat, lng, zoom) => web.current?.injectJavaScript(call("flyTo", lat, lng, zoom)),
    setUserLocation: (lat, lng) => web.current?.injectJavaScript(call("setUser", lat, lng)),
  }));

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let m: { type?: string; id?: unknown; bbox?: unknown; center?: unknown };
      try {
        m = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (m.type === "ready") onReady?.();
      else if (m.type === "tap") onMapPress?.();
      else if (m.type === "marker" && typeof m.id === "string") onMarkerPress?.(m.id);
      else if (m.type === "region" && Array.isArray(m.bbox) && m.bbox.length === 4 && Array.isArray(m.center) && m.bbox.every(Number.isFinite)) {
        // Leaflet pode devolver longitudes fora de ±180 se o usuário arrastar o mundo; a API recusaria.
        const [w, s, e2, n] = m.bbox as number[];
        const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
        onRegion?.(
          { minLng: clamp(w!, 180), minLat: clamp(s!, 90), maxLng: clamp(e2!, 180), maxLat: clamp(n!, 90) },
          { lat: Number(m.center[0]), lng: Number(m.center[1]) },
        );
      }
    },
    [onRegion, onMarkerPress, onMapPress, onReady],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* <object>: o tipo padrão da lib (P = undefined) vira `never` no TS 5.9 */}
      <WebView<object>
        ref={web}
        source={source}
        originWhitelist={["https://*"]}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowsInlineMediaPlayback={false}
        setSupportMultipleWindows={false}
        // Só a página do mapa carrega; links (ex.: atribuição do OSM) abrem no navegador do sistema.
        onShouldStartLoadWithRequest={(req: WebViewNavigation) => {
          if (req.url === "about:blank" || req.url.startsWith("https://sinaly.app/")) return true;
          if (req.url.startsWith("https://www.openstreetmap.org/")) void Linking.openURL(req.url);
          return false;
        }}
        style={{ flex: 1, backgroundColor: "#eef1f7" }}
      />
    </View>
  );
});
