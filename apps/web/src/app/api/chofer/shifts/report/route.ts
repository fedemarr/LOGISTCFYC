import { z } from "zod";
import { jsonError, jsonOk, parseBody, toAppError } from "@/lib/api";
import { requireDriver } from "@/lib/services/driver-qr";
import {
  getActiveShiftForDriver,
  getLatestReport,
  reportProgress,
} from "@/lib/services/shifts";

/**
 * AVANCE (FYM) — PWA del chofer. El aviso de "es hora de reportar" lo
 * dispara la PWA cada `REPORT_INTERVAL_HOURS`; acá el chofer carga en qué
 * paquete va (progreso acumulado del turno).
 * POST /api/chofer/shifts/report { packagesDone, note? }
 */

const reportSchema = z.object({
  packagesDone: z.number().int().min(0).max(1_000_000),
  note: z.string().trim().max(500).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const body = await parseBody(reportSchema, request);

    const report = await reportProgress(driver, body);

    const active = await getActiveShiftForDriver(driver.userId, driver.orgId);
    const latest = await getLatestReport(active?.shift.id ?? "");

    return jsonOk({
      report,
      lastReportedAt: latest?.reportedAt ?? null,
      packageCount: active?.shift.packageCount ?? 0,
      packagesDone: body.packagesDone,
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const driver = await requireDriver(request);
    const active = await getActiveShiftForDriver(driver.userId, driver.orgId);
    if (!active) return jsonOk({ shift: null, lastReport: null });

    const latest = await getLatestReport(active.shift.id);
    return jsonOk({
      shift: {
        id: active.shift.id,
        packageCount: active.shift.packageCount,
        startedAt: active.shift.startedAt,
        zoneId: active.shift.zoneId,
      },
      lastReport: latest,
    });
  } catch (err) {
    return jsonError(toAppError(err));
  }
}
