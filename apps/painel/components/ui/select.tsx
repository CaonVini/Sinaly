"use client";
import * as S from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Select = S.Root;
export const SelectValue = S.Value;

export const SelectTrigger = ({ className, children, ...p }: ComponentProps<typeof S.Trigger>) => (
  <S.Trigger
    className={cn(
      "flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-colors data-[placeholder]:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...p}
  >
    {children}
    <S.Icon asChild>
      <ChevronDown className="size-4 opacity-50" />
    </S.Icon>
  </S.Trigger>
);

export const SelectContent = ({ className, children, ...p }: ComponentProps<typeof S.Content>) => (
  <S.Portal>
    <S.Content
      position="popper"
      sideOffset={4}
      className={cn("z-[1100] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md", className)}
      {...p}
    >
      <S.Viewport className="p-1">{children}</S.Viewport>
    </S.Content>
  </S.Portal>
);

export const SelectItem = ({ className, children, ...p }: ComponentProps<typeof S.Item>) => (
  <S.Item
    className={cn("relative flex cursor-default select-none items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground", className)}
    {...p}
  >
    <S.ItemText>{children}</S.ItemText>
    <S.ItemIndicator className="absolute right-2">
      <Check className="size-4" />
    </S.ItemIndicator>
  </S.Item>
);
