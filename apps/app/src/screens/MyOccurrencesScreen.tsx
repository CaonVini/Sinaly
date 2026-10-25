import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, ApiError, photoSource, type Occurrence } from "../api";
import { useData, useNav } from "../app-state";
import { colors, radius, space } from "../theme";
import { Button, CategoryIcon, Chip, Empty, ErrorBox, Header, StatusBadge, formatDate } from "../ui";

/** Lista paginada por cursor (a API usa keyset): carrega 30 por vez ao rolar. */
export function usePaged<T extends { id: string }>(fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0); // descarta respostas de uma recarga anterior (troca de filtro durante o carregamento)
  const busy = useRef(false);

  const reload = useCallback(async (pull = false) => {
    const g = ++gen.current;
    pull ? setRefreshing(true) : setLoading(true);
    busy.current = true;
    try {
      const r = await fetchPage();
      if (g !== gen.current) return;
      setItems(r.items);
      setCursor(r.nextCursor);
      setError(null);
    } catch (e) {
      if (g === gen.current) setError(e instanceof ApiError ? e.message : "Erro ao carregar.");
    } finally {
      if (g === gen.current) {
        setLoading(false);
        setRefreshing(false);
        busy.current = false;
      }
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  const more = useCallback(async () => {
    if (!cursor || busy.current) return;
    const g = gen.current;
    busy.current = true;
    try {
      const r = await fetchPage(cursor);
      if (g !== gen.current) return;
      // Dedupe por id: se algo foi criado entre as páginas, nada aparece duas vezes.
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...r.items.filter((x) => !seen.has(x.id))];
      });
      setCursor(r.nextCursor);
    } catch {
      /* próxima rolagem tenta de novo */
    } finally {
      if (g === gen.current) busy.current = false;
    }
  }, [cursor, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, setItems, loading, refreshing, error, reload, more, hasMore: !!cursor };
}

export function MyOccurrencesScreen() {
  const { push, setTab } = useNav();
  const { meta, category, version } = useData();
  const [status, setStatus] = useState<string | undefined>();
  const list = usePaged((c) => api.myOccurrences(c, status), [status, version]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Meus relatos" />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2), paddingHorizontal: space(4), paddingBottom: space(3) }}>
          <Chip label="Todos" active={!status} onPress={() => setStatus(undefined)} />
          {meta?.statuses.map((s) => <Chip key={s.slug} label={s.name} color={s.color} active={status === s.slug} onPress={() => setStatus(status === s.slug ? undefined : s.slug)} />)}
        </ScrollView>
      </View>
      {list.error ? <View style={{ paddingHorizontal: space(4) }}><ErrorBox message={list.error} onRetry={() => void list.reload()} /></View> : null}
      {list.loading && list.items.length === 0 ? (
        <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />
      ) : (
        <FlatList
          data={list.items}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: space(4), paddingTop: 0, gap: space(3), flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.reload(true)} tintColor={colors.primary} />}
          onEndReached={() => void list.more()}
          onEndReachedThreshold={0.4}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            list.error ? undefined : (
              <Empty
                icon="map-marker-plus"
                title={status ? "Nenhum relato com este status" : "Você ainda não fez nenhum relato"}
                text="Registre um problema no mapa e acompanhe aqui cada passo da prefeitura."
                action={!status ? <Button title="Registrar agora" onPress={() => (setTab("map"), push({ name: "new" }))} style={{ marginTop: space(3) }} /> : undefined}
              />
            )
          }
          ListFooterComponent={list.hasMore ? <ActivityIndicator color={colors.primary} style={{ margin: space(4) }} /> : undefined}
          renderItem={({ item }) => <OccurrenceRow o={item} cat={category(item.category)} onPress={() => push({ name: "detail", id: item.id })} />}
        />
      )}
    </View>
  );
}

function OccurrenceRow({ o, cat, onPress }: { o: Occurrence; cat: ReturnType<ReturnType<typeof useData>["category"]>; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      {o.thumbUrl ? <Image source={photoSource(o.thumbUrl)} style={s.thumb} /> : <View style={[s.thumb, s.noThumb]}><CategoryIcon category={cat} /></View>}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontWeight: "700", color: colors.text, fontSize: 15 }}>{cat?.name ?? o.category}</Text>
        <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>{o.description}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
          <StatusBadge status={o.status} />
          <Text style={{ color: colors.muted, fontSize: 12 }}>{formatDate(o.createdAt)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: space(3), backgroundColor: colors.card, borderRadius: radius.lg, padding: space(3), borderWidth: 1, borderColor: colors.border },
  thumb: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.border },
  noThumb: { alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
});
