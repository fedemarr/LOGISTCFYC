import * as React from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Diálogo modal (Base UI `Dialog`). Uso típico en los CRUD: confirmación
 * de borrado y formularios de edición en overlay.
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof Dialog.Popup> & { showCloseButton?: boolean }) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
      <Dialog.Popup
        data-slot="dialog-content"
        className={cn(
          "bg-surface text-text fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg outline-none duration-200 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <Dialog.Close
            className="text-text-muted hover:bg-muted hover:text-text focus-visible:ring-3 focus-visible:ring-ring/40 absolute right-3 top-3 rounded-md p-1 outline-none"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </Dialog.Close>
        )}
      </Dialog.Popup>
    </Dialog.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof Dialog.Title>) {
  return (
    <Dialog.Title
      data-slot="dialog-title"
      className={cn("text-base font-semibold leading-none", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      data-slot="dialog-description"
      className={cn("text-text-muted text-sm", className)}
      {...props}
    />
  );
}

const DialogRoot = Dialog.Root;
const DialogTrigger = Dialog.Trigger;

export { DialogRoot, DialogTrigger, DialogContent, DialogTitle, DialogDescription };
