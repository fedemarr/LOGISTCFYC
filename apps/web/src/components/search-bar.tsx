"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "./ui/input";

/**
 * Barra de búsqueda de las listas: el valor se aplica recién al enviar el
 * form (enter o botón), no por keystroke, para no quemar requests.
 */
export function SearchBar({
  placeholder = "Buscar…",
  onSubmit,
  defaultValue,
}: {
  placeholder?: string;
  onSubmit: (value: string) => void;
  defaultValue?: string;
}) {
  const [value, setValue] = React.useState(defaultValue ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value.trim());
      }}
      className="relative w-full sm:w-64"
    >
      <Search className="text-text-muted pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
      <Input
        className="pl-8"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}
