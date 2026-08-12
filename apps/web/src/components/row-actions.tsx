"use client";

import { Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";

/** Menú "⋯" de acciones por fila de las tablas de los CRUD. */
export function RowActions({
  onEdit,
  onDelete,
  editLabel = "Editar",
  deleteLabel = "Eliminar",
}: {
  onEdit: () => void;
  onDelete: () => void;
  editLabel?: string;
  deleteLabel?: string;
}) {
  return (
    <DropdownMenuRoot>
      <DropdownMenuTrigger aria-label="Acciones" />
      <DropdownMenuContent>
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="size-4" />
          {editLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onDelete}
          className="text-status-danger data-[highlighted]:text-status-danger"
        >
          <Trash2 className="size-4" />
          {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuRoot>
  );
}
