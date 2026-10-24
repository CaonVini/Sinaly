"use client";
import type { Map as LMap, Marker } from "leaflet";
import { useEffect, useRef } from "react";
import type { Occurrence } from "@/lib/client";
import { STATUSES, STATUS_LABELS } from "@sinaly/shared";
import { statusColor } from "@/components/status-badge";
import { PIN_ANCHOR, PIN_SIZE, pinHtml } from "@/lib/pin";

const BR_CENTER: [number, number] = [-14.2, -51.9];

/** Mapa Leaflet com um marcador por ocorrência, colorido pelo status. Carregado só no navegador. */
export function OccurrenceMap({ items, selectedId, onSelect, fitKey }: { items: Occurrence[]; selectedId: string | null; onSelect: (id: string) => void; fitKey: string }) {
  const el = useRef<HTMLDivElement>(null);
  const state = useRef<{ L: typeof import("leaflet"); map: LMap; markers: Map<string, Marker> } | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const lastFit = useRef<string | null>(null);
  // O mapa nasce depois do primeiro render (import dinâmico): a sincronização lê sempre os valores mais recentes.
  const latest = useRef({ items, selectedId, fitKey });
  latest.current = { items, selectedId, fitKey };

  useEffect(() => {
    let dead = false;
    (async () => {
      const L = await import("leaflet");
      if (dead || !el.current) return;
      const map = L.map(el.current, { zoomControl: true, worldCopyJump: false }).setView(BR_CENTER, 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>', referrerPolicy: "origin" }).addTo(map);
      state.current = { L, map, markers: new Map() };
      sync();
    })();
    return () => {
      dead = true;
      state.current?.map.remove();
      state.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    const s = state.current;
    if (!s) return;
    const { items, selectedId, fitKey } = latest.current;
    const { L, map, markers } = s;
    const ids = new Set(items.map((i) => i.id));
    for (const [id, m] of markers) if (!ids.has(id)) (m.remove(), markers.delete(id));
    for (const o of items) {
      const icon = L.divIcon({
        className: `sn-pin${o.id === selectedId ? " active" : ""}`,
        html: pinHtml(o.status, o.category),
        iconSize: PIN_SIZE,
        iconAnchor: PIN_ANCHOR,
      });
      const cur = markers.get(o.id);
      if (cur) cur.setIcon(icon).setLatLng([o.lat, o.lng]).setZIndexOffset(o.id === selectedId ? 1000 : 0);
      else markers.set(o.id, L.marker([o.lat, o.lng], { icon, keyboard: false }).on("click", () => onSelectRef.current(o.id)).addTo(map));
    }
    if (items.length && lastFit.current !== fitKey) {
      lastFit.current = fitKey;
      map.fitBounds(L.latLngBounds(items.map((i) => [i.lat, i.lng] as [number, number])), { padding: [48, 48], maxZoom: 16 });
    }
  }

  useEffect(sync, [items, selectedId, fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const o = items.find((i) => i.id === selectedId);
    if (o && state.current) state.current.map.panTo([o.lat, o.lng], { animate: true });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative size-full">
      <div ref={el} className="size-full" role="application" aria-label="Mapa das ocorrências" />
      <ul className="absolute inset-x-3 bottom-7 z-[900] mx-auto flex w-fit flex-wrap justify-center gap-x-4 gap-y-1 rounded-2xl bg-card/95 px-4 py-2 text-xs font-medium shadow-md ring-1 ring-black/5 backdrop-blur" aria-label="Legenda do mapa">
        {STATUSES.map((s) => (
          <li key={s} className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="size-2.5 rounded-full" style={{ background: statusColor(s) }} />
            {STATUS_LABELS[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}
