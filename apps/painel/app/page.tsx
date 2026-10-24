import { STATUSES } from "@sinaly/shared";

export default function Home() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Sinaly · Painel da prefeitura</h1>
      <p>Base pronta. Status do fluxo: {STATUSES.join(" → ")}</p>
    </main>
  );
}
