import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { onboardingSchema, UFS } from "@sinaly/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { colors, radius, space } from "../theme";
import { Button, ErrorBox, Field, Header } from "../ui";

// Mensagens padrão do zod vêm em inglês; os schemas compartilhados só têm texto próprio em alguns campos.
const FALLBACK: Record<string, string> = {
  firstName: "Informe seu nome",
  lastName: "Informe seu sobrenome",
  phone: "Telefone com DDD inválido",
  cpf: "CPF inválido",
  cep: "CEP inválido",
  street: "Informe a rua",
  number: "Informe o número",
  complement: "Máximo de 60 caracteres",
  neighborhood: "Informe o bairro",
  city: "Informe a cidade",
  state: "Escolha a UF",
};
const pt = (field: string, msg?: string) => (!msg || /^(String|Invalid|Required|Expected)/.test(msg) ? FALLBACK[field] ?? "Campo inválido" : msg);

const maskCpf = (v: string) =>
  v.replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const maskCep = (v: string) => v.replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");

export function OnboardingScreen() {
  const { completeOnboarding, logout } = useAuth();
  const [f, setF] = useState({ firstName: "", lastName: "", phone: "", cpf: "", cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const cepReq = useRef(0);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  // Preenche o endereço pelo CEP (ViaCEP, serviço público). Se falhar, o cidadão digita à mão.
  async function onCep(v: string) {
    const masked = maskCep(v);
    set("cep")(masked);
    const digits = masked.replace(/\D/g, "");
    if (digits.length !== 8) return;
    const req = ++cepReq.current;
    setCepLoading(true);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
      const d = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (req !== cepReq.current || d.erro) return; // resposta atrasada de um CEP anterior: ignora
      const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
      setF((s) => ({
        ...s,
        street: str(d.logradouro, 150) || s.street,
        neighborhood: str(d.bairro, 80) || s.neighborhood,
        city: str(d.localidade, 80) || s.city,
        state: (UFS as readonly string[]).includes(d.uf ?? "") ? d.uf! : s.state,
      }));
    } catch {
      /* sem internet ou CEP desconhecido: segue manual */
    } finally {
      if (req === cepReq.current) setCepLoading(false);
    }
  }

  async function submit() {
    setError(null);
    const body = {
      firstName: f.firstName,
      lastName: f.lastName,
      phone: f.phone,
      cpf: f.cpf,
      address: { cep: f.cep, street: f.street, number: f.number, complement: f.complement.trim() || undefined, neighborhood: f.neighborhood, city: f.city, state: f.state.toUpperCase() },
    };
    const parsed = onboardingSchema.safeParse(body);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path.at(-1));
        errs[key] ??= pt(key, issue.message);
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await completeOnboarding(parsed.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível salvar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Header title="Complete seu cadastro" right={<Pressable onPress={logout} hitSlop={10}><Text style={{ color: colors.muted, fontWeight: "600" }}>Sair</Text></Pressable>} />
      <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(12) }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.muted, marginBottom: space(4), lineHeight: 20 }}>
          A prefeitura precisa desses dados para validar os relatos. CPF e endereço ficam cifrados e não aparecem no mapa.
        </Text>
        {error ? <ErrorBox message={error} /> : null}
        <View style={{ flexDirection: "row", gap: space(3) }}>
          <View style={{ flex: 1 }}><Field label="Nome" value={f.firstName} onChangeText={set("firstName")} autoComplete="given-name" error={errors.firstName} /></View>
          <View style={{ flex: 1 }}><Field label="Sobrenome" value={f.lastName} onChangeText={set("lastName")} autoComplete="family-name" error={errors.lastName} /></View>
        </View>
        <Field label="Celular" value={f.phone} onChangeText={(v) => set("phone")(maskPhone(v))} keyboardType="phone-pad" autoComplete="tel" placeholder="(47) 99999-9999" error={errors.phone} />
        <Field label="CPF" value={f.cpf} onChangeText={(v) => set("cpf")(maskCpf(v))} keyboardType="number-pad" placeholder="000.000.000-00" error={errors.cpf} />
        <Field label="CEP" value={f.cep} onChangeText={onCep} keyboardType="number-pad" autoComplete="postal-code" placeholder="00000-000" hint={cepLoading ? "Buscando endereço..." : undefined} error={errors.cep} />
        <Field label="Rua" value={f.street} onChangeText={set("street")} autoComplete="street-address" error={errors.street} />
        <View style={{ flexDirection: "row", gap: space(3) }}>
          <View style={{ width: 110 }}><Field label="Número" value={f.number} onChangeText={set("number")} error={errors.number} /></View>
          <View style={{ flex: 1 }}><Field label="Complemento" value={f.complement} onChangeText={set("complement")} placeholder="Opcional" error={errors.complement} /></View>
        </View>
        <Field label="Bairro" value={f.neighborhood} onChangeText={set("neighborhood")} error={errors.neighborhood} />
        <View style={{ flexDirection: "row", gap: space(3) }}>
          <View style={{ flex: 1 }}><Field label="Cidade" value={f.city} onChangeText={set("city")} error={errors.city} /></View>
          <View style={{ width: 90 }}>
            <Field label="UF" value={f.state} onChangeText={(v) => set("state")(v.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase())} autoCapitalize="characters" maxLength={2} error={errors.state} />
          </View>
        </View>
        <View style={{ backgroundColor: colors.primarySoft, padding: space(3), borderRadius: radius.md, marginBottom: space(4) }}>
          <Text style={{ color: colors.primaryDark, fontSize: 13, lineHeight: 18 }}>
            Seus relatos aparecem no mapa sem seu nome. Só a equipe da prefeitura vê quem enviou.
          </Text>
        </View>
        <Button title="Concluir cadastro" onPress={submit} loading={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
