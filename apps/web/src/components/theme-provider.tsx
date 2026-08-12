"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Tema claro/oscuro (PROMPT-FRONTEND-V2 §2) — oscuro es el default
 * ("el trabajo de depósito es nocturno"), ambos son de primera clase.
 * `attribute="data-theme"` matchea los selectores de
 * `@fyc/config/tailwind/tokens.css` (`[data-theme="light"]` /
 * `[data-theme="dark"]`), no la convención `.dark` de shadcn.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
