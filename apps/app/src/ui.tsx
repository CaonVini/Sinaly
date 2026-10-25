import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CategoryMeta, IconKey } from "@sinaly/shared";
import { useData } from "./app-state";
import { colors, radius, space } from "./theme";

export type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];
export const Icon = MaterialCommunityIcons;

/** Ícones das categorias: as mesmas chaves que o painel usa (ICON_KEYS em @sinaly/shared). */
const CATEGORY_ICONS: Record<IconKey, IconName> = {
  shield: "shield-alert",
  wrench: "wrench",
  signpost: "sign-direction",
  droplet: "water",
  lightbulb: "lightbulb-on",
  trash: "trash-can",
  tree: "tree",
  bus: "bus",
  zap: "flash",
  building: "office-building",
  construction: "traffic-cone",
  car: "car",
  flame: "fire",
  siren: "alarm-light",
  paw: "paw",
  "hard-hat": "hard-hat",
};

export function CategoryIcon({ category, size = 20 }: { category?: CategoryMeta; size?: number }) {
  const color = category?.color ?? colors.muted;
  return (
    <View style={[styles.catIcon, { width: size * 1.8, height: size * 1.8, backgroundColor: `${color}1f` }]}>
      <Icon name={CATEGORY_ICONS[category?.icon as IconKey] ?? "map-marker"} size={size} color={color} />
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { status: get } = useData();
  const s = get(status);
  const color = s?.color ?? colors.muted;
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1f` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{s?.name ?? status}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: ViewStyle;
}) {
  const v = buttonVariants[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: v.bg, borderColor: v.border, opacity: off ? 0.55 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : icon ? <Icon name={icon} size={20} color={v.fg} /> : null}
      <Text style={[styles.buttonText, { color: v.fg }]}>{title}</Text>
    </Pressable>
  );
}

const buttonVariants = {
  primary: { bg: colors.primary, fg: "#fff", border: colors.primary },
  secondary: { bg: colors.card, fg: colors.primary, border: colors.border },
  ghost: { bg: "transparent", fg: colors.primary, border: "transparent" },
  danger: { bg: colors.card, fg: colors.danger, border: colors.border },
};

/** `accessory`: botão pequeno dentro do campo, à direita (ex.: preencher o bairro pelo ponto do mapa). */
export function Field({ label, error, hint, accessory, ...props }: TextInputProps & { label: string; error?: string; hint?: string; accessory?: ReactNode }) {
  return (
    <View style={{ marginBottom: space(3.5) }}>
      <Text style={styles.label}>{label}</Text>
      <View>
        <TextInput
          placeholderTextColor="#9aa2b6"
          {...props}
          style={[styles.input, error ? { borderColor: colors.danger } : null, props.multiline ? { minHeight: 110, textAlignVertical: "top" } : null, accessory ? { paddingRight: 52 } : null, props.style]}
          accessibilityLabel={label}
        />
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export type FilterOption = { value: string | undefined; label: string; color?: string };

/** Botão compacto que mostra o filtro atual; o resto das opções fica na folha de baixo (sem fileira cortada na tela). */
export function FilterButton({ label, active, onPress, loading, floating }: { label: string; active: boolean; onPress: () => void; loading?: boolean; floating?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Filtro: ${label}`}
      style={({ pressed }) => [styles.filterBtn, floating && styles.floating, active && { borderColor: colors.primary }, pressed && { opacity: 0.85 }]}
    >
      <Icon name="filter-variant" size={18} color={active ? colors.primary : colors.muted} />
      <Text style={[styles.filterText, active && { color: colors.primary }]} numberOfLines={1}>
        {label}
      </Text>
      {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="chevron-down" size={18} color={colors.muted} />}
    </Pressable>
  );
}

/** Folha inferior com uma lista de opções (uma escolhida) e, opcionalmente, uma chave liga/desliga. */
export function FilterSheet({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
  toggle,
}: {
  visible: boolean;
  title: string;
  options: FilterOption[];
  value: string | undefined;
  onSelect: (v: string | undefined) => void;
  onClose: () => void;
  toggle?: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void };
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar filtros" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 380 }}>
          {options.map((o) => {
            const sel = o.value === value;
            return (
              <Pressable
                key={o.value ?? "__all"}
                onPress={() => (onSelect(o.value), onClose())}
                style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.bg }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: sel }}
              >
                {o.color ? <View style={[styles.dot, { backgroundColor: o.color, width: 10, height: 10, borderRadius: 5 }]} /> : <Icon name="format-list-bulleted" size={16} color={colors.muted} />}
                <Text style={[styles.optionText, sel && { color: colors.primary, fontWeight: "700" }]}>{o.label}</Text>
                {sel ? <Icon name="check" size={20} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
        {toggle ? (
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionText}>{toggle.label}</Text>
              {toggle.hint ? <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{toggle.hint}</Text> : null}
            </View>
            <Switch value={toggle.value} onValueChange={toggle.onChange} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** Cabeçalho das telas empilhadas (com voltar) e das abas (sem). */
export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space(2) }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Voltar" style={{ marginRight: space(2) }}>
          <Icon name="chevron-left" size={28} color={colors.text} />
        </Pressable>
      ) : null}
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={44} color="#b4bbcc" />
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
      {action}
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Icon name="alert-circle" size={20} color={colors.danger} />
      <Text style={{ flex: 1, color: colors.danger }}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={{ color: colors.danger, fontWeight: "700" }}>Tentar de novo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

export const styles = StyleSheet.create({
  catIcon: { borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: 12, fontWeight: "700" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  button: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", minHeight: 50, paddingHorizontal: space(5), borderRadius: radius.md, borderWidth: 1 },
  buttonText: { fontSize: 16, fontWeight: "700" },
  label: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: 6 },
  accessory: { position: "absolute", right: 4, top: 0, bottom: 0, justifyContent: "center" },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text },
  error: { color: colors.danger, fontSize: 13, marginTop: 4 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space(4), borderWidth: 1, borderColor: colors.border },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", maxWidth: "100%", height: 42, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  floating: { borderColor: "transparent", shadowColor: "#0b1533", shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  filterText: { fontSize: 15, fontWeight: "600", color: colors.text, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(11,21,51,0.35)" },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space(4), paddingTop: space(2) },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space(3) },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.text, marginBottom: space(2) },
  option: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(3.5), paddingHorizontal: space(1), borderRadius: radius.md },
  optionText: { flex: 1, fontSize: 16, color: colors.text },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: space(3), borderTopWidth: 1, borderTopColor: colors.border, marginTop: space(2), paddingTop: space(4), paddingHorizontal: space(1) },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(4), paddingBottom: space(3), backgroundColor: colors.bg },
  headerTitle: { flex: 1, fontSize: 22, fontWeight: "800", color: colors.text },
  empty: { alignItems: "center", padding: space(10), gap: space(2) },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.dangerSoft, padding: space(3), borderRadius: radius.md, marginBottom: space(3) },
});

/** Primeira mensagem de erro por campo, vinda do zod (cliente) ou do `details` da API. */
export function firstErrors(details?: Record<string, string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(details ?? {})) if (v?.[0]) out[k] = v[0];
  return out;
}
