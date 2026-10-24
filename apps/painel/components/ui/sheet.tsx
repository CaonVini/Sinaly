"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Sheet = D.Root;
export const SheetTitle = ({ className, ...p }: ComponentProps<typeof D.Title>) => <D.Title className={cn("text-base font-semibold", className)} {...p} />;
export const SheetDescription = D.Description;

export function SheetContent({ className, children, ...p }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-[1000] bg-black/40" />
      <D.Content
        className={cn("fixed inset-y-0 right-0 z-[1050] flex w-full flex-col border-l bg-card shadow-xl sm:max-w-lg", className)}
        {...p}
      >
        {children}
        <D.Close className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Fechar">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
