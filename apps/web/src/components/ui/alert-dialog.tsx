import * as React from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

/**
 * Confirmación destructiva (Base UI `AlertDialog`). Para borrados y
 * acciones irreversibles de los CRUD — el botón "destructive" está a la
 * izquierda para que el foco inicial caiga en la acción segura (Close).
 */
function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialog.Popup>) {
  return (
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
      <AlertDialog.Popup
        data-slot="alert-dialog-content"
        className={cn(
          "bg-surface text-text fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg outline-none duration-200 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialog.Title>) {
  return (
    <AlertDialog.Title
      data-slot="alert-dialog-title"
      className={cn("text-base font-semibold leading-none", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialog.Description>) {
  return (
    <AlertDialog.Description
      data-slot="alert-dialog-description"
      className={cn("text-text-muted text-sm", className)}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialog.Close>) {
  return (
    <AlertDialog.Close
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialog.Close> & {
  variant?: "destructive" | "default";
}) {
  const { variant = "destructive", ...rest } = props;
  return (
    <AlertDialog.Close
      data-slot="alert-dialog-action"
      className={cn(buttonVariants({ variant }), className)}
      {...rest}
    />
  );
}

const AlertDialogRoot = AlertDialog.Root;
const AlertDialogTrigger = AlertDialog.Trigger;

export {
  AlertDialogRoot,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
};
