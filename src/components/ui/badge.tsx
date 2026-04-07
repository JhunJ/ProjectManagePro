import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", {
  variants: {
    variant: {
      neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
      success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
      warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
      danger: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
