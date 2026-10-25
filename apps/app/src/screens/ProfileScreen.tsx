import { Alert, ScrollView, Text, View } from "react-native";
import Constants from "expo-constants";
import { useAuth } from "../auth";
import { API_URL } from "../config";
import { colors, space } from "../theme";
import { Button, Card, Header, Icon } from "../ui";

export function ProfileScreen() {
  const { state, logout } = useAuth();
  const me = state.kind === "signedIn" ? state.me : null;

  const confirmLogout = () =>
    Alert.alert("Sair da conta?", "Você precisará entrar de novo para registrar relatos.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: () => void logout() },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Perfil" />
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(4) }}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
          <Icon name="account-circle" size={52} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>{me?.name ?? "Cidadão"}</Text>
            <Text style={{ color: colors.muted }}>{me?.email}</Text>
          </View>
        </Card>
        <Card>
          <Text style={{ fontWeight: "700", color: colors.text, marginBottom: space(2) }}>Como funciona</Text>
          {[
            "Você registra o problema com local, categoria, descrição e foto.",
            "A prefeitura verifica o relato. Até lá, só você o vê no mapa.",
            "Aprovado, ele aparece no mapa para todos e você recebe avisos a cada mudança de status.",
            "Depois de resolvido, ele fica no mapa por alguns dias e continua no seu histórico.",
          ].map((t, i) => (
            <Text key={i} style={{ color: colors.muted, lineHeight: 21, marginBottom: space(1.5) }}>
              {i + 1}. {t}
            </Text>
          ))}
        </Card>
        <Button title="Sair da conta" variant="danger" icon="logout" onPress={confirmLogout} />
        <Text style={{ textAlign: "center", color: "#a0a7b8", fontSize: 12 }}>
          Sinaly {Constants.expoConfig?.version}
          {__DEV__ ? ` · API ${API_URL}` : ""}
        </Text>
      </ScrollView>
    </View>
  );
}
