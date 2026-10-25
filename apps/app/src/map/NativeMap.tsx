import * as Location from "expo-location";
import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Marker, type MapPressEvent, type Region } from "react-native-maps";
import type { ServiceArea } from "@sinaly/shared";
import type { Bbox } from "../api";

/**
 * Mapa nativo (Google Maps no Android, Apple Maps no iOS). Substituiu o Leaflet em WebView, que dependia de
 * baixar a biblioteca de um CDN a cada abertura e desenhava tudo em JavaScript dentro de um navegador embutido.
 * No Expo Go funciona sem configuração; para o APK, o Android exige uma chave do Google Maps (ver README).
 */
export type MapMarker = { id: string; lat: number; lng: number; color: string; mine?: boolean };
export type NativeMapHandle = { flyTo: (lat: number, lng: number, zoom?: number) => void };
type Props = {
  center: { lat: number; lng: number; zoom: number };
  markers?: MapMarker[];
  onRegion?: (bbox: Bbox, center: { lat: number; lng: number }) => void;
  onMarkerPress?: (id: string) => void;
  onMapPress?: () => void;
  /** Área de atuação da prefeitura (Configuração no painel): o mapa abre nela e não deixa sair. */
  area?: ServiceArea | null;
};

// Aproximação de "zoom" (estilo web) para a extensão da região que o MapView usa.
const delta = (zoom: number) => 360 / 2 ** zoom;
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

/** Região que enquadra a área inteira (com uma folga pequena). */
export function areaRegion(a: ServiceArea): Region {
  const [w, so, e, n] = a.bbox;
  return { latitude: (so + n) / 2, longitude: (w + e) / 2, latitudeDelta: (n - so) * 1.1, longitudeDelta: (e - w) * 1.1 };
}

const toBbox = (r: Region): Bbox => ({
  minLng: clamp(r.longitude - r.longitudeDelta / 2, 180),
  minLat: clamp(r.latitude - r.latitudeDelta / 2, 90),
  maxLng: clamp(r.longitude + r.longitudeDelta / 2, 180),
  maxLat: clamp(r.latitude + r.latitudeDelta / 2, 90),
});

export const NativeMap = forwardRef<NativeMapHandle, Props>(function NativeMap({ center, markers = [], onRegion, onMarkerPress, onMapPress, area }, ref) {
  const map = useRef<MapView>(null);
  // Sem ponto definido (centro padrão), abre já enquadrando a área de atuação.
  const [initialRegion] = useState<Region>(() =>
    area && center.zoom < 10 ? areaRegion(area) : { latitude: center.lat, longitude: center.lng, latitudeDelta: delta(center.zoom), longitudeDelta: delta(center.zoom) },
  );
  const moved = useRef(false); // já foi levado a um ponto (GPS, local marcado): a área chegando depois não muda a vista
  const ready = useRef(false);
  // O ponto azul do usuário é desenhado pelo próprio mapa, mas só depois da permissão concedida.
  const [showUser, setShowUser] = useState(false);
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then((p) => setShowUser(p.granted), () => undefined);
  }, []);

  useImperativeHandle(ref, () => ({
    flyTo: (lat, lng, zoom = 16) => {
      moved.current = true;
      setShowUser(true);
      map.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: delta(zoom), longitudeDelta: delta(zoom) }, 500);
    },
  }));

  // Marcadores personalizados viram imagem uma vez e param de ser redesenhados (tracksViewChanges=false).
  // No Android, desligar antes do primeiro desenho deixa o marcador em branco: liga por um instante a cada lista nova.
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 400);
    return () => clearTimeout(t);
  }, [markers]);

  // Trava na área. No Android (Google Maps) o próprio mapa impede sair (setMapBoundaries); no iOS não existe
  // essa opção, então ao soltar o mapa fora da área ele volta para a borda (veja onRegionChangeComplete).
  const areaKey = area ? area.bbox.join(",") : "";
  const applyArea = () => {
    if (!area || !map.current || !ready.current) return;
    const [w, so, e, n] = area.bbox;
    if (Platform.OS === "android") map.current.setMapBoundaries({ latitude: n, longitude: e }, { latitude: so, longitude: w });
    if (!moved.current && center.zoom < 10) map.current.animateToRegion(areaRegion(area), 0);
  };
  useEffect(applyArea, [areaKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const bounceBack = (r: Region) => {
    if (!area) return false;
    const [w, so, e, n] = area.bbox;
    const lat = Math.min(n, Math.max(so, r.latitude));
    const lng = Math.min(e, Math.max(w, r.longitude));
    // Zoom afastado demais (mostrando o estado inteiro) também volta para o enquadramento da área.
    // Folga de 4x: o mapa ajusta a região à proporção da tela, então o enquadramento da área já passa de 1x.
    const tooFar = r.latitudeDelta > (n - so) * 4;
    // Tolerância (~10 m): a região devolvida pelo mapa nunca bate exatamente com a pedida, e sem ela ficaria em laço.
    if (Math.abs(lat - r.latitude) < 1e-4 && Math.abs(lng - r.longitude) < 1e-4 && !tooFar) return false;
    const box = areaRegion(area);
    map.current?.animateToRegion(tooFar ? box : { ...r, latitude: lat, longitude: lng }, 250);
    return true;
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onMapReady={() => {
          ready.current = true;
          applyArea();
          onRegion?.(toBbox(initialRegion), { lat: initialRegion.latitude, lng: initialRegion.longitude });
        }}
        onRegionChangeComplete={(r) => {
          if (bounceBack(r)) return; // a região corrigida dispara outro evento, esse sim repassado
          onRegion?.(toBbox(r), { lat: r.latitude, lng: r.longitude });
        }}
        onPress={(e: MapPressEvent) => {
          if (e.nativeEvent.action !== "marker-press") onMapPress?.();
        }}
        showsUserLocation={showUser}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        showsPointsOfInterests={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {markers.map((m) => (
          <Pin key={m.id} m={m} tracks={tracks} onPress={onMarkerPress} />
        ))}
      </MapView>
    </View>
  );
});

const Pin = memo(function Pin({ m, tracks, onPress }: { m: MapMarker; tracks: boolean; onPress?: (id: string) => void }) {
  return (
    <Marker coordinate={{ latitude: m.lat, longitude: m.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks} onPress={() => onPress?.(m.id)}>
      <View style={[s.pin, { backgroundColor: m.color }, m.mine && s.mine]} />
    </Marker>
  );
});

const s = StyleSheet.create({
  pin: { width: 18, height: 18, borderRadius: 9, borderWidth: 2.5, borderColor: "#fff" },
  mine: { width: 20, height: 20, borderRadius: 10, borderColor: "#1b2136", borderStyle: "dashed" },
});
