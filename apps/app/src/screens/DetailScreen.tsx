import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StatusKind } from "@sinaly/shared";
import { api, ApiError, photoSource, type Occurrence } from "../api";
import { useData, useNav } from "../app-state";
import { colors, radius, space } from "../theme";
import { CategoryIcon, ErrorBox, Header, Icon, formatDate, formatDateTime, type IconName } from "../ui";

// Uma frase por tipo de status: o cidadão entende em que pé está sem conhecer o fluxo interno da prefeitura.
const KIND_TEXT: Record<StatusKind, { icon: IconName; text: string }> = {
  initial: { icon: "eye-off-outline", text: "Aguardando a prefeitura verificar. Até lá, só você vê este relato." },
  active: { icon: "progress-wrench", text: "A prefeitura está cuidando deste relato." },
  resolved: { icon: "check-circle-outline", text: "Problema resolvido. Obrigado por avisar!" },
  rejected: { icon: "close-circle-outline", text: "A prefeitura não deu andamento a este relato." },
};

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
  const st = o ? status(o.status) : undefined;
  const color = st?.color ?? colors.muted;
  const kind = st ? KIND_TEXT[st.kind] : undefined;
  const history = o?.history ? [...o.history].reverse() : [];
  const lastNote = history.find((h) => h.note); // resposta mais recente da prefeitura, em destaque no topo

  const openMaps = () => {
    if (!o) return;
    const url = Platform.OS === "ios" ? `http://maps.apple.com/?ll=${o.lat},${o.lng}&q=Ocorrência` : `geo:${o.lat},${o.lng}?q=${o.lat},${o.lng}`;
    void Linking.openURL(url).catch(() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lng}#map=18/${o.lat}/${o.lng}`));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Relato" onBack={pop} />
      {!o && !error ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: space(10) }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space(4), paddingTop: 0, paddingBottom: space(12), gap: space(3) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => (setRefreshing(true), await load(), setRefreshing(false))} tintColor={colors.primary} />}
        >
          {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
          {o ? (
            <>
              {/* Situação: cor do status, nome e o que isso significa. */}
              <View style={[s.status, { backgroundColor: `${color}14`, borderColor: `${color}40` }]}>
                <View style={[s.statusIcon, { backgroundColor: color }]}>
                  <Icon name={kind?.icon ?? "information-outline"} size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.statusName, { color }]}>{st?.name ?? o.status}</Text>
                  {kind ? <Text style={s.statusText}>{kind.text}</Text> : null}
                </View>
              </View>

              {lastNote ? (
                <View style={s.reply}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginBottom: space(1.5) }}>
                    <Icon name="message-reply-text-outline" size={18} color={colors.primaryDark} />
                    <Text style={{ fontWeight: "800", color: colors.primaryDark, flex: 1 }}>Resposta da prefeitura</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{formatDate(lastNote.at)}</Text>
                  </View>
                  <Text style={{ color: colors.text, lineHeight: 21 }}>{lastNote.note}</Text>
                </View>
              ) : null}

              {/* O relato em si */}
              <View style={s.card}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
                  <CategoryIcon category={cat} size={20} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: "800", color: colors.text }}>{cat?.name ?? o.category}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Enviado em {formatDate(o.createdAt)}</Text>
                  </View>
                </View>
                {o.photoUrl && !photoFailed ? (
                  // A foto de relato ainda não verificado só é entregue ao autor: vai com o token no cabeçalho.
                  <Image source={photoSource(o.photoUrl)} style={s.photo} resizeMode="cover" onError={() => setPhotoFailed(true)} accessibilityLabel="Foto do problema" />
                ) : null}
                <Text style={s.body}>{o.description}</Text>
                <Pressable onPress={openMaps} style={({ pressed }) => [s.place, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="Abrir local no app de mapas">
                  <Icon name="map-marker" size={20} color={colors.primary} />
                  <Text style={{ flex: 1, fontWeight: "600", color: colors.text }} numberOfLines={1}>
                    {o.neighborhood ?? "Local marcado no mapa"}
                  </Text>
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>Abrir mapa</Text>
                  <Icon name="open-in-new" size={16} color={colors.primary} />
                </Pressable>
              </View>

              {history.length ? (
                <View style={s.card}>
                  <Text style={s.cardTitle}>Andamento</Text>
                  {history.map((h, i) => {
                    const hs = status(h.to);
                    const last = i === history.length - 1;
                    return (
                      <View key={`${h.at}-${i}`} style={{ flexDirection: "row", gap: space(3) }}>
                        <View style={{ alignItems: "center", width: 14 }}>
                          <View style={[s.tlDot, { backgroundColor: hs?.color ?? colors.muted }, i > 0 && s.tlDotPast]} />
                          {!last ? <View style={s.tlLine} /> : null}
                        </View>
                        <View style={{ flex: 1, paddingBottom: last ? 0 : space(4) }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
                            <Text style={{ fontWeight: i === 0 ? "800" : "600", color: colors.text, flex: 1 }}>{hs?.name ?? h.to}</Text>
                            <Text style={{ color: colors.muted, fontSize: 12 }}>{formatDateTime(h.at)}</Text>
                          </View>
                          {h.note && h !== lastNote ? <Text style={s.tlNote}>{h.note}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  status: { flexDirection: "row", alignItems: "center", gap: space(3), borderRadius: radius.lg, borderWidth: 1, padding: space(3.5) },
  statusIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  statusName: { fontSize: 17, fontWeight: "800" },
  statusText: { color: colors.text, fontSize: 13, lineHeight: 18, marginTop: 2 },
  reply: { backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: space(3.5), borderLeftWidth: 4, borderLeftColor: colors.primary },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space(4), gap: space(3) },
  cardTitle: { fontSize: 13, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  photo: { width: "100%", height: 200, borderRadius: radius.md, backgroundColor: colors.border },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  place: { flexDirection: "row", alignItems: "center", gap: space(2), backgroundColor: colors.bg, borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(2.5) },
  tlDot: { width: 14, height: 14, borderRadius: 7, marginTop: 3, borderWidth: 3, borderColor: "#fff" },
  tlDotPast: { opacity: 0.55 },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  tlNote: { color: colors.muted, lineHeight: 19, marginTop: 4, fontSize: 13 },
});
