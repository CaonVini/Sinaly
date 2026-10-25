import * as Location from "expo-location";
import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, type MapPressEvent, type Region } from "react-native-maps";
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
};

// Aproximação de "zoom" (estilo web) para a extensão da região que o MapView usa.
const delta = (zoom: number) => 360 / 2 ** zoom;
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

const toBbox = (r: Region): Bbox => ({
  minLng: clamp(r.longitude - r.longitudeDelta / 2, 180),
  minLat: clamp(r.latitude - r.latitudeDelta / 2, 90),
  maxLng: clamp(r.longitude + r.longitudeDelta / 2, 180),
  maxLat: clamp(r.latitude + r.latitudeDelta / 2, 90),
});

export const NativeMap = forwardRef<NativeMapHandle, Props>(function NativeMap({ center, markers = [], onRegion, onMarkerPress, onMapPress }, ref) {
  const map = useRef<MapView>(null);
  const [initialRegion] = useState<Region>(() => ({ latitude: center.lat, longitude: center.lng, latitudeDelta: delta(center.zoom), longitudeDelta: delta(center.zoom) }));
  // O ponto azul do usuário é desenhado pelo próprio mapa, mas só depois da permissão concedida.
  const [showUser, setShowUser] = useState(false);
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then((p) => setShowUser(p.granted), () => undefined);
  }, []);

  useImperativeHandle(ref, () => ({
    flyTo: (lat, lng, zoom = 16) => {
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

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onMapReady={() => onRegion?.(toBbox(initialRegion), center)}
        onRegionChangeComplete={(r) => onRegion?.(toBbox(r), { lat: r.latitude, lng: r.longitude })}
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
