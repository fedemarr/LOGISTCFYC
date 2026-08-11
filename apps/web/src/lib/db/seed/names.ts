// Nombres sintéticos genéricos para destinatarios de prueba — no son datos
// de personas reales, solo variedad para que el seed no repita "Juan Pérez"
// 120 veces.
const FIRST_NAMES = [
  "Juan",
  "María",
  "Carlos",
  "Ana",
  "Miguel",
  "Laura",
  "Diego",
  "Sofía",
  "Martín",
  "Valentina",
  "Federico",
  "Camila",
  "Lucas",
  "Julieta",
  "Nicolás",
  "Florencia",
  "Matías",
  "Agustina",
  "Tomás",
  "Victoria",
];

const LAST_NAMES = [
  "Pérez",
  "González",
  "Rodríguez",
  "Fernández",
  "López",
  "Díaz",
  "Martínez",
  "Sánchez",
  "Romero",
  "Álvarez",
  "Torres",
  "Ruiz",
  "Ramírez",
  "Flores",
  "Acosta",
  "Benítez",
  "Medina",
  "Herrera",
  "Suárez",
  "Rojas",
];

export function syntheticRecipientName(seed: number): string {
  const first = FIRST_NAMES[seed % FIRST_NAMES.length];
  const last = LAST_NAMES[Math.floor(seed / FIRST_NAMES.length) % LAST_NAMES.length];
  return `${first} ${last}`;
}
