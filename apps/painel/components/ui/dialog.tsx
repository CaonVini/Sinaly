"use client";
import * as D from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTitle = ({ className, ...p }: ComponentProps<typeof D.Title>) => <D.Title className={cn("text-base font-semibold", className)} {...p} />;
export const DialogDescription = ({ className, ...p }: ComponentProps<typeof D.Description>) => <D.Description className={cn("text-sm text-muted-foreground", className)} {...p} />;

/** Modal centralizado no padrão do painel (substitui confirm()/alert() nativos). */
export function DialogContent({ className, children, ...p }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-[1000] bg-black/40" />
      <D.Content className={cn("fixed top-1/2 left-1/2 z-[1050] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border bg-card p-6 shadow-xl", className)} {...p}>
        {children}
      </D.Content>
    </D.Portal>
  );
}
