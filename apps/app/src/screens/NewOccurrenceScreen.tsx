import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createOccurrenceFieldsSchema } from "@sinaly/shared";
import { api, ApiError } from "../api";
import { useData, useNav } from "../app-state";
import { DEFAULT_CENTER } from "../config";
import { LeafletMap, type LeafletMapHandle } from "../map/LeafletMap";
import { colors, radius, space } from "../theme";
import { Button, CategoryIcon, ErrorBox, Field, Header, Icon } from "../ui";

type Point = { lat: number; lng: number };
const MAX_SIDE = 1600; // px: legível para a prefeitura e ~300-600 KB em JPEG (a API aceita até 5 MB)

/** Reduz e recomprime a foto no aparelho: upload rápido no 4G e sem metadados (EXIF com GPS, modelo do celular). */
async function shrink(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_SIDE) ctx.resize(asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return out.uri;
}

export function NewOccurrenceScreen({ at }: { at?: Point }) {
  const { pop } = useNav();
  const { meta, bump } = useData();
  // O ponto começa pelo GPS (quem relata costuma estar no local); a área vista no mapa só posiciona o seletor.
  const [point, setPoint] = useState<Point | null>(null);
  const [picking, setPicking] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setPoint((p) => p ?? { lat: pos.coords.latitude, lng: pos.coords.longitude });
    })().catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickPhoto(source: "camera" | "library") {
    const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permissão negada", source === "camera" ? "Libere o acesso à câmera nas configurações do celular." : "Libere o acesso às fotos nas configurações do celular.");
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, exif: false, allowsEditing: false };
    const r = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return;
    setPhotoBusy(true);
    try {
      setPhoto(await shrink(r.assets[0]));
    } catch {
      Alert.alert("Foto", "Não foi possível processar a imagem. Tente outra.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit() {
    setError(null);
    const fields = { category: category ?? "", description, neighborhood, lat: point ? String(point.lat) : "", lng: point ? String(point.lng) : "" };
    const parsed = createOccurrenceFieldsSchema.safeParse(fields);
    const errs: Record<string, string> = {};
    if (!category) errs.category = "Escolha uma categoria";
    if (!point) errs.location = "Marque o local no mapa";
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors;
      if (fe.description) errs.description = description.trim().length < 10 ? "Descreva com pelo menos 10 caracteres" : "Máximo de 1000 caracteres";
      if (fe.neighborhood) errs.neighborhood = "Entre 2 e 80 caracteres";
    }
    setErrors(errs);
    if (Object.keys(errs).length || !parsed.success) return;

    const form = new FormData();
    form.append("category", parsed.data.category);
    form.append("description", parsed.data.description);
    if (parsed.data.neighborhood) form.append("neighborhood", parsed.data.neighborhood);
    form.append("lat", String(parsed.data.lat));
    form.append("lng", String(parsed.data.lng));
    // O fetch do Expo (padrão desde o SDK 52+) não aceita o antigo `{ uri, name, type }` do React Native:
    // o arquivo vai como File do expo-file-system, que ele sabe ler. O TS do DOM não conhece esse tipo.
    if (photo) form.append("photo", new File(photo) as unknown as Blob);

    setSending(true);
    try {
      await api.createOccurrence(form);
      bump();
      Alert.alert("Relato enviado!", "A prefeitura vai verificar e você recebe um aviso quando o status mudar.");
      pop();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.status === 429 ? e.message || "Você atingiu o limite de envios. Tente mais tarde." : e.message);
      } else setError("Não foi possível enviar. Tente de novo.");
    } finally {
      setSending(false);
    }
  }

  if (picking) return <LocationPicker initial={point} around={at} onCancel={() => setPicking(false)} onConfirm={(p) => (setPoint(p), setPicking(false))} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Header title="Novo relato" onBack={pop} />
      <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(16) }} keyboardShouldPersistTaps="handled">
        {error ? <ErrorBox message={error} /> : null}

        <Text style={s.section}>Onde?</Text>
        <Pressable onPress={() => setPicking(true)} style={[s.box, errors.location ? { borderColor: colors.danger } : null]} accessibilityRole="button">
          <Icon name="map-marker" size={26} color={point ? colors.primary : colors.muted} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", color: colors.text }}>{point ? "Local marcado" : "Marcar no mapa"}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)} · toque para ajustar` : "Toque para escolher o ponto exato"}</Text>
          </View>
          <Icon name="chevron-left" size={22} color={colors.muted} style={{ transform: [{ rotate: "180deg" }] }} />
        </Pressable>
        {errors.location ? <Text style={s.err}>{errors.location}</Text> : null}

        <Text style={s.section}>O que é?</Text>
        <View style={s.grid}>
          {meta?.categories
            .filter((c) => c.active)
            .map((c) => {
              const active = category === c.slug;
              return (
                <Pressable
                  key={c.slug}
                  onPress={() => setCategory(c.slug)}
                  style={[s.cat, active && { borderColor: c.color, backgroundColor: `${c.color}14` }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <CategoryIcon category={c} size={18} />
                  <Text style={{ fontWeight: "600", color: colors.text, flexShrink: 1 }} numberOfLines={2}>
                    {c.name}
                  </Text>
                </Pressable>
              );
            })}
        </View>
        {errors.category ? <Text style={s.err}>{errors.category}</Text> : null}

        <Text style={s.section}>Conte o que aconteceu</Text>
        <Field
          label="Descrição"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={1000}
          placeholder="Ex.: Poste com a lâmpada apagada há uma semana, em frente ao número 120."
          hint={`${description.trim().length}/1000`}
          error={errors.description}
        />
        <Field label="Bairro ou ponto de referência" value={neighborhood} onChangeText={setNeighborhood} maxLength={80} placeholder="Opcional" error={errors.neighborhood} />

        <Text style={s.section}>Foto</Text>
        {photo ? (
          <View>
            <Image source={{ uri: photo }} style={s.preview} resizeMode="cover" accessibilityLabel="Foto do problema" />
            <Pressable onPress={() => setPhoto(null)} style={s.remove} accessibilityLabel="Remover foto" accessibilityRole="button">
              <Icon name="close" size={20} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: space(3) }}>
            <Button title="Câmera" icon="camera" variant="secondary" onPress={() => void pickPhoto("camera")} loading={photoBusy} style={{ flex: 1 }} />
            <Button title="Galeria" icon="image" variant="secondary" onPress={() => void pickPhoto("library")} disabled={photoBusy} style={{ flex: 1 }} />
          </View>
        )}
        <Text style={[s.hintText, { marginBottom: space(6) }]}>Uma foto ajuda a prefeitura a entender e priorizar o problema.</Text>

        <Button title="Enviar relato" onPress={submit} loading={sending} disabled={photoBusy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Tela cheia: o pino fica fixo no centro e o cidadão arrasta o mapa até o ponto certo. */
function LocationPicker({ initial, around, onCancel, onConfirm }: { initial: Point | null; around?: Point; onCancel: () => void; onConfirm: (p: Point) => void }) {
  const insets = useSafeAreaInsets();
  const map = useRef<LeafletMapHandle>(null);
  const [center, setCenter] = useState<Point | null>(initial);
  const start = initial ? { ...initial, zoom: 18 } : around && around.lat !== DEFAULT_CENTER.lat ? { ...around, zoom: 16 } : DEFAULT_CENTER;

  async function gps() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    map.current?.setUserLocation(pos.coords.latitude, pos.coords.longitude);
    map.current?.flyTo(pos.coords.latitude, pos.coords.longitude, 18);
  }

  return (
    <View style={{ flex: 1 }}>
      <LeafletMap ref={map} center={start} onRegion={(_b, c) => setCenter(c)} onReady={() => (initial ? undefined : void gps().catch(() => undefined))} />
      <View pointerEvents="none" style={s.pinWrap}>
        <Icon name="map-marker" size={48} color={colors.primary} style={{ marginBottom: 48 }} />
      </View>
      <View style={[s.pickTop, { paddingTop: insets.top + space(2) }]}>
        <Pressable onPress={onCancel} style={s.roundBtn} accessibilityLabel="Cancelar" accessibilityRole="button">
          <Icon name="close" size={24} color={colors.text} />
        </Pressable>
        <View style={s.tip}>
          <Text style={{ color: colors.text, fontWeight: "600" }}>Arraste o mapa até o pino ficar sobre o local</Text>
        </View>
      </View>
      <View style={[s.pickBottom, { paddingBottom: insets.bottom + space(4) }]}>
        <Pressable onPress={() => void gps().catch(() => undefined)} style={[s.roundBtn, { alignSelf: "flex-end", marginBottom: space(3) }]} accessibilityLabel="Minha localização" accessibilityRole="button">
          <Icon name="crosshairs-gps" size={24} color={colors.primary} />
        </Pressable>
        <Button title="Confirmar local" onPress={() => center && onConfirm(center)} disabled={!center} icon="check-circle" />
      </View>
    </View>
  );
}

const shadow = { shadowColor: "#0b1533", shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 };
const s = StyleSheet.create({
  section: { fontSize: 13, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginTop: space(4), marginBottom: space(2) },
  box: { flexDirection: "row", alignItems: "center", gap: space(3), backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space(3.5) },
  err: { color: colors.danger, fontSize: 13, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  cat: { flexDirection: "row", alignItems: "center", gap: space(2), width: "48.5%", backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: space(2.5) },
  preview: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.border },
  remove: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.6)", width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  hintText: { color: colors.muted, fontSize: 13, marginTop: space(2) },
  pinWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  pickTop: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", gap: space(3), paddingHorizontal: space(4), alignItems: "center" },
  tip: { flex: 1, backgroundColor: "#fff", borderRadius: radius.md, padding: space(3), ...shadow },
  roundBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", ...shadow },
  pickBottom: { position: "absolute", left: space(4), right: space(4), bottom: 0 },
});
