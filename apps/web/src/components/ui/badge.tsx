import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        neutral: "border-transparent bg-muted text-text-muted",
        outline: "border-border text-text",
        success: "border-transparent bg-status-success/10 text-status-success",
        warning: "border-transparent bg-status-warning/10 text-status-warning",
        danger: "border-transparent bg-status-danger/10 text-status-danger",
        info: "border-transparent bg-status-info/10 text-status-info",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
