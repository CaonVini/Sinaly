"use client";
import type { ServiceArea } from "@sinaly/shared";
import type { Map as LMap, Rectangle } from "leaflet";
import { Check, Loader2, MapPin, Maximize, Search, Unlock } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";
import { useMeta } from "@/lib/meta";
import { addBaseLayer } from "@/lib/tiles";

type Place = { name: string; detail: string; bbox: ServiceArea["bbox"] };
const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Configuração → Área de atuação. O admin busca o município pelo nome (ou enquadra no mapa e usa "a área visível")
 * e salva. O app e o painel passam a abrir e ficar travados nessa área, e a API recusa ocorrências fora dela.
 */
export function ServiceAreaConfig({ canEdit }: { canEdit: boolean }) {
  const { meta, reload } = useMeta();
  const saved = meta.serviceArea ?? null;
  const [draft, setDraft] = useState<ServiceArea | null>(saved);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const st = useRef<{ L: typeof import("leaflet"); map: LMap; rect: Rectangle | null } | null>(null);

  useEffect(() => setDraft(saved), [JSON.stringify(saved)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let dead = false;
    (async () => {
      const L = await import("leaflet");
      if (dead || !el.current) return;
      const map = L.map(el.current).setView([-14.2, -51.9], 4);
      addBaseLayer(L, map);
      st.current = { L, map, rect: null };
      draw(draft);
    })();
    return () => {
      dead = true;
      st.current?.map.remove();
      st.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw(a: ServiceArea | null) {
    const s = st.current;
    if (!s) return;
    s.rect?.remove();
    s.rect = null;
    if (!a) return;
    const [w, so, e, n] = a.bbox;
    s.rect = s.L.rectangle([[so, w], [n, e]], { color: "#2349d6", weight: 2, fillOpacity: 0.06, interactive: false }).addTo(s.map);
    s.map.fitBounds(s.rect.getBounds(), { padding: [24, 24] });
  }
  useEffect(() => draw(draft), [JSON.stringify(draft)]); // eslint-disable-line react-hooks/exhaustive-deps

  async function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      setResults((await api<{ items: Place[] }>(`staff/geocode/search?q=${encodeURIComponent(q.trim())}`)).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na busca");
    } finally {
      setSearching(false);
    }
  }

  function useVisible() {
    const s = st.current;
    if (!s) return;
    const b = s.map.getBounds();
    setDraft({ name: draft?.name ?? "Área personalizada", bbox: [round(b.getWest()), round(b.getSouth()), round(b.getEast()), round(b.getNorth())] });
  }

  async function save(area: ServiceArea | null) {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      await api("staff/config/service-area", { method: "PUT", body: { area } });
      await reload();
      setMsg(area ? `Área salva: ${area.name}. O app e o painel já usam o novo limite.` : "Limite removido: o mapa fica livre.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Card>
        <CardHeader><CardTitle>Área de atuação</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">O mapa do app e do painel abre nesta área e não sai dela, e a API recusa relatos marcados fora.</p>
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Em uso</p>
            <p className="font-medium">{saved ? saved.name : "Sem limite"}</p>
          </div>
          {canEdit && (
            <>
              <form onSubmit={search} className="flex gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar município (ex.: Concórdia)" maxLength={100} aria-label="Buscar município" />
                <Button type="submit" variant="outline" disabled={searching || q.trim().length < 2} aria-label="Buscar">{searching ? <Loader2 className="animate-spin" /> : <Search />}</Button>
              </form>
              {results && (
                <ul className="divide-y rounded-lg border">
                  {results.length === 0 && <li className="p-3 text-muted-foreground">Nada encontrado. Tente outro nome ou enquadre no mapa.</li>}
                  {results.map((r, i) => (
                    <li key={i}>
                      <button type="button" className="flex w-full items-start gap-2 p-3 text-left hover:bg-muted" onClick={() => (setDraft({ name: r.detail ? `${r.name} (${r.detail.split(",")[0]})` : r.name, bbox: r.bbox }), setResults(null))}>
                        <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span><span className="block font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{r.detail}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={useVisible}><Maximize /> Usar a área visível no mapa</Button>
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button onClick={() => save(draft)} disabled={!changed || !draft || saving}>{saving ? <Loader2 className="animate-spin" /> : <Check />} Salvar {draft ? draft.name : ""}</Button>
                {saved && <Button variant="outline" onClick={() => save(null)} disabled={saving}><Unlock /> Remover limite</Button>}
              </div>
            </>
          )}
          {msg && <p role="status" className="text-muted-foreground">{msg}</p>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </CardContent>
      </Card>
      <div className="h-[28rem] overflow-hidden rounded-xl border">
        <div ref={el} className="size-full" role="application" aria-label="Mapa da área de atuação" />
      </div>
    </div>
  );
}
