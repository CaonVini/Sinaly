import { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api, type Notification } from "../api";
import { useData, useNav } from "../app-state";
import { colors, radius, space } from "../theme";
import { Empty, ErrorBox, Header, Icon, formatDateTime } from "../ui";
import { usePaged } from "./MyOccurrencesScreen";

export function NotificationsScreen() {
  const { push } = useNav();
  const { unread, refreshUnread, status, version } = useData();
  const list = usePaged<Notification>((c) => api.notifications(c), [version]);

  // Chegou aviso novo enquanto a aba estava aberta (o contador SUBIU): recarrega a lista.
  const prevUnread = useRef(unread);
  useEffect(() => {
    if (unread > prevUnread.current) void list.reload();
    prevUnread.current = unread;
  }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(n: Notification) {
    if (!n.readAt) {
      const now = new Date().toISOString();
      list.setItems((items) => items.map((x) => (x.id === n.id ? { ...x, readAt: now } : x))); // otimista
      api.markRead(n.id).then(refreshUnread, () => undefined);
    }
    if (n.occurrenceId) push({ name: "detail", id: n.occurrenceId });
  }

  async function readAll() {
    const now = new Date().toISOString();
    list.setItems((items) => items.map((x) => (x.readAt ? x : { ...x, readAt: now })));
    await api.markAllRead().catch(() => undefined);
    refreshUnread();
  }

  /** Apaga todos os avisos (só os do próprio cidadão, na API). Os relatos e o andamento continuam intactos. */
  function clearAll() {
    Alert.alert("Limpar avisos?", "Todos os avisos serão apagados. Seus relatos e o andamento deles continuam em \"Meus relatos\".", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Limpar",
        style: "destructive",
        onPress: async () => {
          const before = list.items;
          list.setItems([]); // otimista
          try {
            await api.clearNotifications();
          } catch {
            list.setItems(before);
            Alert.alert("Avisos", "Não foi possível limpar agora. Tente de novo.");
          }
          refreshUnread();
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header
        title="Avisos"
        right={
          list.items.length > 0 ? (
            <View style={{ flexDirection: "row", gap: space(1), alignItems: "center" }}>
              {unread > 0 ? (
                <Pressable onPress={readAll} hitSlop={6} style={s.action} accessibilityRole="button" accessibilityLabel="Marcar todos como lidos">
                  <Icon name="check-all" size={22} color={colors.primary} />
                </Pressable>
              ) : null}
              <Pressable onPress={clearAll} hitSlop={6} style={s.clear} accessibilityRole="button" accessibilityLabel="Limpar avisos">
                <Icon name="trash-can-outline" size={18} color={colors.danger} />
                <Text style={{ color: colors.danger, fontWeight: "700" }}>Limpar</Text>
              </Pressable>
            </View>
          ) : undefined
        }
      />
      {list.error ? <View style={{ paddingHorizontal: space(4) }}><ErrorBox message={list.error} onRetry={() => void list.reload()} /></View> : null}
      {list.loading && list.items.length === 0 ? (
        <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />
      ) : (
        <FlatList
          data={list.items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: space(4), paddingTop: 0, gap: space(2), flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => (void list.reload(true), refreshUnread())} tintColor={colors.primary} />}
          onEndReached={() => void list.more()}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={list.error ? undefined : <Empty icon="bell-outline" title="Nenhum aviso ainda" text="Quando a prefeitura mudar o status de um relato seu, você fica sabendo aqui." />}
          ListFooterComponent={list.hasMore ? <ActivityIndicator color={colors.primary} style={{ margin: space(4) }} /> : undefined}
          renderItem={({ item: n }) => {
            const to = n.toStatus ? status(n.toStatus) : undefined;
            return (
              <Pressable onPress={() => void open(n)} style={({ pressed }) => [s.row, !n.readAt && s.unread, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                <View style={[s.icon, { backgroundColor: `${to?.color ?? colors.primary}1f` }]}>
                  <Icon name="bell" size={18} color={to?.color ?? colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: n.readAt ? "600" : "800", color: colors.text }}>{n.title}</Text>
                  {n.body ? <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 19 }}>{n.body}</Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{formatDateTime(n.createdAt)}</Text>
                </View>
                {!n.readAt ? <View style={s.dot} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  action: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  clear: { flexDirection: "row", alignItems: "center", gap: 4, height: 40, paddingHorizontal: space(2.5), borderRadius: radius.pill, backgroundColor: colors.dangerSoft },
  row: { flexDirection: "row", gap: space(3), backgroundColor: colors.card, borderRadius: radius.lg, padding: space(3.5), borderWidth: 1, borderColor: colors.border },
  unread: { borderColor: colors.primary, backgroundColor: "#fbfcff" },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 },
});
