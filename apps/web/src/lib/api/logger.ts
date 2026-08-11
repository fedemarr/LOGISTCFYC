/**
 * Logger estructurado mínimo (PROMPT-MAESTRO §0.8: "NO uses console.log
 * en producción. Logger estructurado.").
 *
 * Emite una línea JSON por evento a stdout (lo que Vercel y cualquier
 * collector de logs espera), respeta `LOG_LEVEL` y soporta bindings por
 * contexto (`logger.child({...})` para agregar requestId/orgId sin
 * repetirlos en cada llamada). Sin dependencias: el surface es tan chico
 * que un logger a medida no agrega riesgo de mantenimiento; si en FASE 13
 * se quiere Sentry/algún logger con transporte, se reemplaza acá sin tocar
 * a los callers. Ver docs/DECISIONES.md.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const fromEnv = process.env.LOG_LEVEL?.toLowerCase();
  if (fromEnv && fromEnv in LEVEL_ORDER) return fromEnv as LogLevel;
  return "info";
}

type Fields = Record<string, unknown>;

interface LogLine extends Fields {
  level: LogLevel;
  time: string;
  msg: string;
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}

export function createLogger(initialBindings: Fields = {}): Logger {
  const threshold = LEVEL_ORDER[configuredLevel()];

  function write(level: LogLevel, msg: string, fields: Fields = {}): void {
    if (LEVEL_ORDER[level] < threshold) return;
    const line: LogLine = {
      level,
      time: new Date().toISOString(),
      msg,
      ...initialBindings,
      ...fields,
    };
    // La excepción documentada a no-console: los CLI scripts. Para
    // requests HTTP, stdout es la interfaz correcta (Vercel lo captura).
    process.stdout.write(`${JSON.stringify(line)}\n`);
  }

  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
    child(bindings: Fields): Logger {
      return createLogger({ ...initialBindings, ...bindings });
    },
  };
}

export const logger = createLogger();
