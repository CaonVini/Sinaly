import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppStateProvider, useData, useNav, type Tab } from "./src/app-state";
import { AuthProvider, useAuth } from "./src/auth";
import { AuthScreen } from "./src/screens/AuthScreen";
import { DetailScreen } from "./src/screens/DetailScreen";
import { MapScreen } from "./src/screens/MapScreen";
import { MyOccurrencesScreen } from "./src/screens/MyOccurrencesScreen";
import { NewOccurrenceScreen } from "./src/screens/NewOccurrenceScreen";
import { NotificationsScreen } from "./src/screens/NotificationsScreen";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { colors, space } from "./src/theme";
import { Button, Icon, type IconName } from "./src/ui";

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { state, retry, logout } = useAuth();
  if (state.kind === "loading") {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (state.kind === "offline") {
    return (
      <View style={[s.center, { padding: space(8), gap: space(3) }]}>
        <Icon name="wifi-off" size={44} color={colors.muted} />
        <Text style={{ fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" }}>Sem conexão com o Sinaly</Text>
        <Text style={{ color: colors.muted, textAlign: "center" }}>{state.message}</Text>
        <Button title="Tentar de novo" onPress={retry} icon="refresh" />
        <Button title="Sair da conta" variant="ghost" onPress={() => void logout()} />
      </View>
    );
  }
  if (state.kind === "signedOut") return <AuthScreen />;
  if (!state.me.onboardingComplete) return <OnboardingScreen />;
  return (
    <AppStateProvider>
      <Main />
    </AppStateProvider>
  );
}

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "map", label: "Mapa", icon: "map-search" },
  { key: "mine", label: "Meus relatos", icon: "format-list-bulleted" },
  { key: "notifications", label: "Avisos", icon: "bell-outline" },
  { key: "profile", label: "Perfil", icon: "account-circle" },
];

function Main() {
  const { tab, setTab, stack } = useNav();
  const { unread } = useData();
  const insets = useSafeAreaInsets();
  // Abas já abertas continuam montadas (o mapa não recarrega ao trocar de aba); as outras só montam na primeira visita.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["map"]));
  // Ajuste durante o render (padrão do React para estado derivado): a aba pode mudar por fora (ex.: botão voltar).
  if (!visited.has(tab)) setVisited((v) => new Set(v).add(tab));
  const top = stack.at(-1);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        {visited.has("map") && <View style={[s.fill, tab !== "map" && s.hidden]}><MapScreen /></View>}
        {visited.has("mine") && <View style={[s.fill, tab !== "mine" && s.hidden]}><MyOccurrencesScreen /></View>}
        {visited.has("notifications") && <View style={[s.fill, tab !== "notifications" && s.hidden]}><NotificationsScreen /></View>}
        {visited.has("profile") && <View style={[s.fill, tab !== "profile" && s.hidden]}><ProfileScreen /></View>}
      </View>
      <View style={[s.tabs, { paddingBottom: Math.max(insets.bottom, space(2)) }]}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={s.tab} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={t.label}>
              <View>
                <Icon name={t.icon} size={25} color={active ? colors.primary : colors.muted} />
                {t.key === "notifications" && unread > 0 ? (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{unread > 9 ? "9+" : unread}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[s.tabLabel, active && { color: colors.primary }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {/* Telas empilhadas cobrem as abas; só a do topo é renderizada. */}
      {top ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
          {top.name === "new" ? <NewOccurrenceScreen at={top.at} /> : <DetailScreen key={top.id} id={top.id} />}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  fill: { ...StyleSheet.absoluteFill },
  hidden: { display: "none" },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(2) },
  tab: { flex: 1, alignItems: "center", gap: 2 },
  tabLabel: { fontSize: 11, fontWeight: "600", color: colors.muted },
  badge: { position: "absolute", top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
});
