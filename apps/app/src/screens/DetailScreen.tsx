import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, ApiError, photoSource, type Occurrence } from "../api";
import { useData, useNav } from "../app-state";
import { colors, radius, space } from "../theme";
import { CategoryIcon, ErrorBox, Header, Icon, StatusBadge, formatDate, formatDateTime } from "../ui";

export function DetailScreen({ id }: { id: string }) {
  const { pop } = useNav();
  const { category, status, version } = useData();
  const [o, setO] = useState<Occurrence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setO(await api.occurrence(id));
      setError(null);
      setPhotoFailed(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível carregar.");
    }
  }, [id]);
  useEffect(() => void load(), [load, version]);

  const cat = o ? category(o.category) : undefined;
  const openMaps = () => {
    if (!o) return;
    const url = Platform.OS === "ios" ? `http://maps.apple.com/?ll=${o.lat},${o.lng}&q=Ocorrência` : `geo:${o.lat},${o.lng}?q=${o.lat},${o.lng}`;
    void Linking.openURL(url).catch(() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lng}#map=18/${o.lat}/${o.lng}`));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Detalhes" onBack={pop} />
      {!o && !error ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: space(10) }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space(4), paddingBottom: space(12) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => (setRefreshing(true), await load(), setRefreshing(false))} tintColor={colors.primary} />}
        >
          {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
          {o ? (
            <>
              {o.photoUrl && !photoFailed ? (
                // A foto de relato ainda não verificado só é entregue ao autor: vai com o token no cabeçalho.
                <Image source={photoSource(o.photoUrl)} style={s.photo} resizeMode="cover" onError={() => setPhotoFailed(true)} accessibilityLabel="Foto do problema" />
              ) : null}

              <View style={{ flexDirection: "row", alignItems: "center", gap: space(3), marginTop: space(4) }}>
                <CategoryIcon category={cat} size={22} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 20, fontWeight: "800", color: colors.text }}>{cat?.name ?? o.category}</Text>
                  <Text style={{ color: colors.muted }}>Enviado em {formatDate(o.createdAt)}</Text>
                </View>
              </View>
              <View style={{ marginTop: space(3) }}>
                <StatusBadge status={o.status} />
              </View>

              <Text style={s.body}>{o.description}</Text>

              <Pressable onPress={openMaps} style={s.place} accessibilityRole="button">
                <Icon name="map-marker" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", color: colors.text }}>{o.neighborhood ?? "Local marcado no mapa"}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Abrir no app de mapas</Text>
                </View>
              </Pressable>

              {o.history ? (
                <>
                  <Text style={s.section}>Andamento</Text>
                  <View style={{ gap: 0 }}>
                    {[...o.history].reverse().map((h, i, arr) => {
                      const st = status(h.to);
                      return (
                        <View key={`${h.at}-${i}`} style={{ flexDirection: "row", gap: space(3) }}>
                          <View style={{ alignItems: "center", width: 16 }}>
                            <View style={[s.tlDot, { backgroundColor: st?.color ?? colors.muted }]} />
                            {i < arr.length - 1 ? <View style={s.tlLine} /> : null}
                          </View>
                          <View style={{ flex: 1, paddingBottom: space(5) }}>
                            <Text style={{ fontWeight: "700", color: colors.text }}>{st?.name ?? h.to}</Text>
                            <Text style={{ color: colors.muted, fontSize: 12 }}>{formatDateTime(h.at)}</Text>
                            {h.note ? (
                              <View style={s.note}>
                                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primaryDark, marginBottom: 2 }}>Comentário da prefeitura</Text>
                                <Text style={{ color: colors.text, lineHeight: 20 }}>{h.note}</Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: colors.border },
  body: { fontSize: 16, lineHeight: 24, color: colors.text, marginTop: space(4) },
  place: { flexDirection: "row", alignItems: "center", gap: space(3), backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space(3.5), marginTop: space(4) },
  section: { fontSize: 13, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginTop: space(6), marginBottom: space(3) },
  tlDot: { width: 14, height: 14, borderRadius: 7, marginTop: 3 },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  note: { backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: space(3), marginTop: space(2) },
});
