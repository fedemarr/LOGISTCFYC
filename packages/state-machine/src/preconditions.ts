export type TransitionMetadata = Record<string, unknown>;

/** `null` = precondición cumplida. Un string = motivo del rechazo. */
export type Precondition = (metadata: TransitionMetadata) => string | null;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasGpsCoords(value: unknown): value is { lat: number; lng: number } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.lat === "number" && typeof v.lng === "number";
}

/**
 * EN_DOMICILIO → ENTREGADO (§4: "ENTREGADO exige evidencia + GPS"; §9.5:
 * nombre del receptor obligatorio, GPS automático).
 */
export const requireDeliveryEvidence: Precondition = (metadata) => {
  if (!isNonEmptyString(metadata.receiverName)) {
    return "falta el nombre de quien recibe (receiverName).";
  }
  if (!hasGpsCoords(metadata.gps)) {
    return "falta la ubicación GPS de la entrega (gps: { lat, lng }).";
  }
  return null;
};

/**
 * EN_DOMICILIO → FALLA_REPORTADA (§9.7: "selecciona motivo → foto
 * (obligatoria) → comentario").
 */
export const requireIncidentReport: Precondition = (metadata) => {
  if (!isNonEmptyString(metadata.reason)) {
    return "falta el motivo de la incidencia (reason).";
  }
  if (!isNonEmptyString(metadata.photoUrl)) {
    return "falta la foto de la incidencia (photoUrl), es obligatoria.";
  }
  return null;
};

/**
 * FALLA_REPORTADA/DANIADO → ENTREGADO (§4: "excepción, requiere evidencia
 * del chofer").
 */
export const requireDriverEvidenceOverride: Precondition = (metadata) => {
  if (!isNonEmptyString(metadata.driverEvidencePhotoUrl)) {
    return "entregar igual pese a la falla/daño requiere foto de evidencia del chofer (driverEvidencePhotoUrl).";
  }
  return null;
};

/** Estados de excepción (§4): siempre necesitan motivo explícito. */
export const requireExceptionReason: Precondition = (metadata) => {
  if (!isNonEmptyString(metadata.reason)) {
    return "los estados de excepción (EXTRAVIADO/DANIADO/CANCELADO) requieren un motivo (reason).";
  }
  return null;
};

/** Reapertura de un estado final (§4): admin, y queda como corrección. */
export const requireCorrectionReason: Precondition = (metadata) => {
  if (!isNonEmptyString(metadata.correctionReason)) {
    return "reabrir un estado final requiere un motivo de corrección (correctionReason).";
  }
  return null;
};
