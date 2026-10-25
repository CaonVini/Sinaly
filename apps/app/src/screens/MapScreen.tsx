import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError, type Bbox, type Occurrence } from "../api";
import { useData, useNav } from "../app-state";
import { DEFAULT_CENTER } from "../config";
import { LeafletMap, type LeafletMapHandle, type MapMarker } from "../map/LeafletMap";
import { colors, radius, space } from "../theme";
import { CategoryIcon, Chip, Icon, StatusBadge, formatDate } from "../ui";

export function MapScreen() {
  const insets = useSafeAreaInsets();
  const { push } = useNav();
  const { meta, category, status, version } = useData();
  const map = useRef<LeafletMapHandle>(null);
  const [ready, setReady] = useState(false);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const center = useRef<{ lat: number; lng: number }>(DEFAULT_CENTER);
  const [cat, setCat] = useState<string | undefined>();
  const [showResolved, setShowResolved] = useState(false);
  const [publicItems, setPublicItems] = useState<Occurrence[]>([]);
  const [mine, setMine] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // Ocorrências públicas da área visível. Debounce de 350 ms ao arrastar e cancelamento da requisição
  // anterior: só a resposta mais recente é desenhada (sem "piscar" marcadores de outra área).
  useEffect(() => {
    if (!bbox) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.map(bbox, showResolved, cat, ctrl.signal);
        setPublicItems(r.items);
        setTruncated(r.truncated);
        setError(null);
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof ApiError ? e.message : "Não foi possível carregar o mapa.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [bbox, showResolved, cat, version]);

  // Regra: ocorrência ainda não verificada não é pública, mas o próprio autor a vê no mapa (contorno tracejado).
  useEffect(() => {
    const initial = meta?.statuses.find((s) => s.kind === "initial")?.slug; // só existe um status inicial
    if (!initial) return;
    api.myOccurrences(undefined, initial, 100).then((r) => setMine(r.items), () => undefined);
  }, [meta, version]);

  const all = useMemo(() => {
    const byId = new Map<string, Occurrence & { mine?: boolean }>();
    for (const o of publicItems) byId.set(o.id, o);
    for (const o of mine) if (!cat || o.category === cat) byId.set(o.id, { ...o, mine: true });
    return byId;
  }, [publicItems, mine, cat]);

  useEffect(() => {
    if (!ready) return;
    const markers: MapMarker[] = [...all.values()].map((o) => ({ id: o.id, lat: o.lat, lng: o.lng, color: status(o.status)?.color ?? colors.muted, mine: o.mine }));
    map.current?.setMarkers(markers);
  }, [all, ready, status]);

  const locate = useCallback(async (fly: boolean) => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return;
    const last = await Location.getLastKnownPositionAsync();
    if (last && fly) map.current?.flyTo(last.coords.latitude, last.coords.longitude, 16);
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    map.current?.setUserLocation(pos.coords.latitude, pos.coords.longitude);
    if (fly) map.current?.flyTo(pos.coords.latitude, pos.coords.longitude, 16);
  }, []);

  useEffect(() => {
    if (ready) void locate(true).catch(() => undefined);
  }, [ready, locate]);

  const sel = selected ? all.get(selected) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LeafletMap
        ref={map}
        center={DEFAULT_CENTER}
        onReady={() => setReady(true)}
        onRegion={(b, c) => {
          center.current = c;
          setBbox(b);
        }}
        onMarkerPress={setSelected}
        onMapPress={() => setSelected(null)}
      />

      {/* Filtros */}
      <View style={[s.top, { paddingTop: insets.top + space(2) }]} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2), paddingHorizontal: space(3) }}>
          <Chip label="Todas" active={!cat} onPress={() => setCat(undefined)} />
          {meta?.categories
            .filter((c) => c.active)
            .map((c) => <Chip key={c.slug} label={c.name} color={c.color} active={cat === c.slug} onPress={() => setCat(cat === c.slug ? undefined : c.slug)} />)}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: space(2), paddingHorizontal: space(3), marginTop: space(2), alignItems: "center" }}>
          <Chip label={showResolved ? "Resolvidas: todas" : `Resolvidas: últimos ${meta?.resolvedVisibleDays ?? 5} dias`} active={showResolved} onPress={() => setShowResolved((v) => !v)} />
          {loading ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
        {error ? <Text style={s.banner}>{error}</Text> : truncated ? <Text style={s.banner}>Muitas ocorrências nesta área. Aproxime o mapa para ver todas.</Text> : null}
      </View>

      {/* Botões flutuantes */}
      <View style={[s.fabs, { bottom: (sel ? 190 : 0) + space(4) }]} pointerEvents="box-none">
        <Pressable style={s.round} onPress={() => void locate(true).catch(() => undefined)} accessibilityLabel="Minha localização" accessibilityRole="button">
          <Icon name="crosshairs-gps" size={24} color={colors.primary} />
        </Pressable>
        <Pressable style={s.fab} onPress={() => push({ name: "new", at: center.current })} accessibilityRole="button">
          <Icon name="map-marker-plus" size={22} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Registrar</Text>
        </Pressable>
      </View>

      {/* Ocorrência selecionada */}
      {sel ? (
        <Pressable style={s.sheet} onPress={() => push({ name: "detail", id: sel.id })} accessibilityRole="button">
          <View style={{ flexDirection: "row", gap: space(3), alignItems: "center" }}>
            <CategoryIcon category={category(sel.category)} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text }}>{category(sel.category)?.name ?? sel.category}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {sel.neighborhood ? `${sel.neighborhood} · ` : ""}
                {formatDate(sel.createdAt)}
              </Text>
            </View>
            <StatusBadge status={sel.status} />
          </View>
          <Text numberOfLines={2} style={{ marginTop: space(3), color: colors.text, lineHeight: 20 }}>
            {sel.description}
          </Text>
          {sel.mine ? <Text style={{ marginTop: space(2), color: colors.warning, fontSize: 12, fontWeight: "600" }}>Só você vê este relato até a prefeitura verificar.</Text> : null}
          <Text style={{ marginTop: space(2), color: colors.primary, fontWeight: "700" }}>Ver detalhes ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const shadow = { shadowColor: "#0b1533", shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 };
const s = StyleSheet.create({
  top: { position: "absolute", left: 0, right: 0, top: 0 },
  banner: { marginHorizontal: space(3), marginTop: space(2), backgroundColor: "#fff", padding: space(2.5), borderRadius: radius.md, color: colors.text, fontSize: 13, ...shadow },
  fabs: { position: "absolute", right: space(4), alignItems: "flex-end", gap: space(3) },
  round: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", ...shadow },
  fab: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: colors.primary, paddingHorizontal: space(5), height: 54, borderRadius: radius.pill, ...shadow },
  sheet: { position: "absolute", left: space(3), right: space(3), bottom: space(3), backgroundColor: "#fff", borderRadius: radius.lg, padding: space(4), ...shadow },
});
