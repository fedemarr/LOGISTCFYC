// Barrel de @fyc/shared.
//
// FASE 1 solo deja el package scaffoldeado con lo verdaderamente
// transversal (roles). Los tipos de dominio (Package, Route, Delivery...)
// y los esquemas Zod de validación se agregan en las fases que los
// necesitan (FASE 2 modelo de datos, FASE 3 backend) para no adivinar
// forma de datos que todavía no está migrada.

export * from "./constants/roles";
