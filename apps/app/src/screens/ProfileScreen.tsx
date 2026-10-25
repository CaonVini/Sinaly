import Constants from "expo-constants";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useData, useNav } from "../app-state";
import { useAuth } from "../auth";
import { API_URL } from "../config";
import { colors, radius, space } from "../theme";
import { Header, Icon, type IconName } from "../ui";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "map-marker-plus", title: "Você registra", text: "Local, categoria, descrição e foto." },
  { icon: "shield-check-outline", title: "A prefeitura verifica", text: "Até lá, só você vê o relato no mapa." },
  { icon: "bell-ring-outline", title: "Você acompanha", text: "Aviso a cada mudança de status." },
  { icon: "check-circle-outline", title: "Resolvido", text: "Fica no mapa por alguns dias e no seu histórico." },
];

/** Iniciais para o avatar: "Maria Souza" → "MS"; sem nome, a primeira letra do e-mail. */
const initials = (name: string | null | undefined, email: string | undefined) => {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length) return ((parts[0]![0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] ?? "" : "")).toUpperCase();
  return (email?.[0] ?? "?").toUpperCase();
};

export function ProfileScreen() {
  const { state, logout } = useAuth();
  const { setTab } = useNav();
  const { unread, meta } = useData();
  const me = state.kind === "signedIn" ? state.me : null;

  const confirmLogout = () =>
    Alert.alert("Sair da conta?", "Você precisará entrar de novo para registrar relatos.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: () => void logout() },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Perfil" />
      <ScrollView contentContainerStyle={{ padding: space(4), paddingTop: 0, paddingBottom: space(10), gap: space(4) }}>
        <View style={s.hero}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials(me?.name, me?.email)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>{me?.name ?? "Cidadão"}</Text>
            <Text style={s.email} numberOfLines={1}>{me?.email}</Text>
            {meta?.serviceArea ? (
              <View style={s.areaTag}>
                <Icon name="map-marker-radius" size={13} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }} numberOfLines={1}>{meta.serviceArea.name}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.group}>
          <Row icon="clipboard-text-outline" label="Meus relatos" onPress={() => setTab("mine")} />
          <View style={s.sep} />
          <Row icon="bell-outline" label="Avisos" badge={unread} onPress={() => setTab("notifications")} />
        </View>

        <View>
          <Text style={s.groupTitle}>Como funciona</Text>
          <View style={[s.group, { padding: space(4), gap: space(3.5) }]}>
            {STEPS.map((st, i) => (
              <View key={st.title} style={{ flexDirection: "row", gap: space(3), alignItems: "center" }}>
                <View style={s.stepIcon}>
                  <Icon name={st.icon} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", color: colors.text }}>{i + 1}. {st.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>{st.text}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={s.group}>
          <Row icon="logout" label="Sair da conta" danger onPress={confirmLogout} />
        </View>

        <Text style={{ textAlign: "center", color: "#a0a7b8", fontSize: 12 }}>
          Sinaly {Constants.expoConfig?.version}
          {__DEV__ ? ` · API ${API_URL}` : ""}
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ icon, label, onPress, badge, danger }: { icon: IconName; label: string; onPress: () => void; badge?: number; danger?: boolean }) {
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.bg }]} accessibilityRole="button">
      <Icon name={icon} size={22} color={danger ? colors.danger : colors.primary} />
      <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: tint }}>{label}</Text>
      {badge ? (
        <View style={s.badge}>
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      ) : null}
      {!danger ? <Icon name="chevron-right" size={22} color="#b4bbcc" /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: space(4), backgroundColor: colors.primary, borderRadius: radius.lg, padding: space(4.5) },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 24, fontWeight: "800" },
  name: { color: "#fff", fontSize: 19, fontWeight: "800" },
  email: { color: "rgba(255,255,255,0.8)", fontSize: 14, marginTop: 2 },
  areaTag: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.18)", borderRadius: radius.pill, paddingHorizontal: space(2.5), paddingVertical: 3, marginTop: space(2), maxWidth: "100%" },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  groupTitle: { fontSize: 13, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: space(2), marginLeft: space(1) },
  row: { flexDirection: "row", alignItems: "center", gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3.5) },
  sep: { height: 1, backgroundColor: colors.border, marginLeft: space(4) + 22 + space(3) },
  stepIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
});
