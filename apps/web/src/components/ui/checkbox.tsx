import * as React from "react";
import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "border-input bg-background shadow-xs checked:border-primary checked:bg-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 peer size-4 shrink-0 cursor-pointer appearance-none rounded border outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50",
        "checked:after:bg-primary-foreground after:absolute after:left-1/2 after:top-1/2 after:size-2.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-[3px] after:bg-transparent after:content-['']",
        "relative",
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox };
