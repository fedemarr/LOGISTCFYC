// Serializer de Metro para que Sentry pueda subir source maps con Debug IDs
// (FASE 13 — Sentry mobile). Envuelve la config por defecto de Expo, no
// cambia nada del bundling normal.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

module.exports = config;
