import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loginSchema, PASSWORD_MIN_CITIZEN, registerSchema } from "@sinaly/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { API_URL } from "../config";
import { colors, space } from "../theme";
import { Button, ErrorBox, Field, firstErrors, Icon } from "../ui";

export function AuthScreen() {
  const { login, register } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const parsed = (mode === "login" ? loginSchema : registerSchema).safeParse({ email, password });
    const errs = parsed.success ? {} : firstErrors(parsed.error.flatten().fieldErrors);
    if (mode === "register" && password !== confirm) errs.confirm = "As senhas não conferem";
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length) return;
    setBusy(true);
    try {
      await (mode === "login" ? login(parsed.data.email, parsed.data.password) : register(parsed.data.email, parsed.data.password));
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(firstErrors(e.details));
        setError(e.status === 429 ? "Muitas tentativas. Aguarde um pouco e tente de novo." : e.message);
      } else setError("Algo deu errado. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const switchMode = () => {
    setMode((m) => (m === "login" ? "register" : "login"));
    setErrors({});
    setError(null);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: space(6), paddingTop: insets.top + space(12), flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", marginBottom: space(8) }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
            <Icon name="map-marker" size={36} color="#fff" />
          </View>
          <Text style={{ fontSize: 30, fontWeight: "800", color: colors.text, marginTop: space(3) }}>Sinaly</Text>
          <Text style={{ fontSize: 15, color: colors.muted, textAlign: "center", marginTop: space(1) }}>
            Viu um problema na cidade? Registre no mapa e acompanhe até a prefeitura resolver.
          </Text>
        </View>

        {error ? <ErrorBox message={error} /> : null}
        <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" error={errors.email} />
        <Field
          label="Senha"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          textContentType={mode === "login" ? "password" : "newPassword"}
          hint={mode === "register" ? `Mínimo de ${PASSWORD_MIN_CITIZEN} caracteres` : undefined}
          error={errors.password}
        />
        {mode === "register" ? <Field label="Confirmar senha" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" error={errors.confirm} /> : null}

        <Button title={mode === "login" ? "Entrar" : "Criar conta"} onPress={submit} loading={busy} style={{ marginTop: space(2) }} />
        <Pressable onPress={switchMode} style={{ padding: space(4), alignItems: "center" }} accessibilityRole="button">
          <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 15 }}>
            {mode === "login" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
          </Text>
        </Pressable>

        <View style={{ flex: 1 }} />
        {__DEV__ ? <Text style={{ color: "#a0a7b8", fontSize: 12, textAlign: "center" }}>API: {API_URL}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
