"use client";
import { CATEGORIES, CATEGORY_LABELS, STAFF_CREATE_STATUSES, STATUS_LABELS, type Category } from "@sinaly/shared";
import { Loader2, MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, type FormEvent } from "react";
import type { Point } from "@/components/location-picker";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Occurrence } from "@/lib/client";

const LocationPicker = dynamic(() => import("@/components/location-picker").then((m) => m.LocationPicker), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

const MAX_PHOTO = 5 * 1024 * 1024;

export function NewOccurrenceSheet({ open, onClose, onCreated, center }: { open: boolean; onClose: () => void; onCreated: (o: Occurrence) => void; center?: Point | null }) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined}>{open && <Form onCreated={onCreated} center={center} />}</SheetContent>
    </Sheet>
  );
}

function Form({ onCreated, center }: { onCreated: (o: Occurrence) => void; center?: Point | null }) {
  const [category, setCategory] = useState<Category>("infraestrutura");
  const [status, setStatus] = useState<(typeof STAFF_CREATE_STATUSES)[number]>("em_analise");
  const [point, setPoint] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    if (!point) return setError("Clique no mapa para marcar o local da ocorrência.");
    const photo = f.get("photo");
    const body = new FormData();
    body.set("category", category);
    body.set("status", status);
    body.set("description", String(f.get("description") ?? "").trim());
    body.set("lat", String(point.lat));
    body.set("lng", String(point.lng));
    for (const k of ["reporterName", "reporterPhone"]) {
      const v = String(f.get(k) ?? "").trim();
      if (v) body.set(k, v);
    }
    if (photo instanceof File && photo.size > 0) {
      if (photo.size > MAX_PHOTO) return setError("A foto passa de 5 MB.");
      body.set("photo", photo);
    }
    setBusy(true);
    try {
      onCreated(await api<Occurrence>("staff/occurrences", { method: "POST", body }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <header className="space-y-1 border-b p-5 pr-12">
        <SheetTitle>Nova ocorrência</SheetTitle>
        <SheetDescription className="text-xs text-muted-foreground">Registro feito pela prefeitura, por exemplo uma ligação. A foto é opcional.</SheetDescription>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status inicial</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STAFF_CREATE_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Descrição</Label>
          <Textarea id="description" name="description" required minLength={10} maxLength={1000} placeholder="O que foi relatado e onde exatamente." />
        </div>

        <div className="space-y-2">
          <Label>Local <span className="font-normal text-muted-foreground">(clique no mapa)</span></Label>
          <LocationPicker value={point} onChange={setPoint} center={center} />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5" />
            {point ? <span className="font-mono">{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</span> : "Nenhum local marcado"}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="photo">Foto <span className="font-normal text-muted-foreground">(opcional, até 5 MB)</span></Label>
          <Input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs" />
        </div>

        <fieldset className="space-y-3 rounded-lg border bg-muted/40 p-4">
          <legend className="px-1 text-sm font-medium">Quem relatou <span className="font-normal text-muted-foreground">(opcional)</span></legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="reporterName">Nome</Label>
              <Input id="reporterName" name="reporterName" maxLength={120} autoComplete="off" className="bg-card" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reporterPhone">Telefone</Label>
              <Input id="reporterPhone" name="reporterPhone" inputMode="tel" maxLength={20} placeholder="(11) 91234-5678" autoComplete="off" className="bg-card" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Guardado cifrado e visível só para funcionários.</p>
        </fieldset>

        {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>

      <footer className="border-t p-4">
        <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Registrar ocorrência</Button>
      </footer>
    </form>
  );
}
