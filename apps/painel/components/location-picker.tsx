"use client";
import type { Map as LMap, Marker } from "leaflet";
import { useEffect, useRef } from "react";
import { PIN_ANCHOR, PIN_SIZE, pinHtml } from "@/lib/pin";

export type Point = { lat: number; lng: number };

/** Mapa para escolher o local clicando. O ponto é controlado pelo formulário (value/onChange). */
export function LocationPicker({ value, onChange, center }: { value: Point | null; onChange: (p: Point) => void; center?: Point | null }) {
  const el = useRef<HTMLDivElement>(null);
  const st = useRef<{ L: typeof import("leaflet"); map: LMap; marker: Marker | null } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const latest = useRef(value);
  latest.current = value;

  function draw() {
    const s = st.current;
    if (!s) return;
    const v = latest.current;
    if (!v) {
      s.marker?.remove();
      s.marker = null;
      return;
    }
    if (s.marker) s.marker.setLatLng([v.lat, v.lng]);
    else s.marker = s.L.marker([v.lat, v.lng], { icon: s.L.divIcon({ className: "sn-pin", html: pinHtml("brand", null), iconSize: PIN_SIZE, iconAnchor: PIN_ANCHOR }) }).addTo(s.map);
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      const L = await import("leaflet");
      if (dead || !el.current) return;
      const start = latest.current ?? center;
      const map = L.map(el.current).setView(start ? [start.lat, start.lng] : [-14.2, -51.9], start ? 15 : 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
        referrerPolicy: "origin",
      }).addTo(map);
      map.on("click", (e) => onChangeRef.current({ lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) }));
      st.current = { L, map, marker: null };
      draw();
    })();
    return () => {
      dead = true;
      st.current?.map.remove();
      st.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
    const s = st.current;
    if (s && value && !s.map.getBounds().contains([value.lat, value.lng])) s.map.panTo([value.lat, value.lng]);
  }, [value?.lat, value?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="h-64 w-full overflow-hidden rounded-lg border" role="application" aria-label="Mapa para escolher o local" />;
}
