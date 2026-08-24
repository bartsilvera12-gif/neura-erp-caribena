import { NextRequest, NextResponse } from "next/server";
import { requireModule } from "@/lib/middleware/require-module";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { facturarSesionPg } from "@/lib/mesas/server/mesas-pg";
import { successResponse, errorResponse } from "@/lib/api/response";

/**
 * POST /api/mesas/sesiones/[id]/facturar — convierte la cuenta en venta.
 * Idempotente: si la sesión ya tiene venta_id, no crea otra. Exige caja abierta.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireModule(request, "ventas");
    if (!gate.ok) return NextResponse.json(errorResponse(gate.error), { status: gate.status });
    const auth = gate.auth;
    const { id } = await ctx.params;

    let body: unknown = {};
    try { body = await request.json(); } catch { /* sin body → efectivo por defecto */ }
    const o = (body ?? {}) as Record<string, unknown>;
    const metodoPago: "efectivo" | "tarjeta" | "transferencia" =
      o.metodo_pago === "tarjeta" || o.metodo_pago === "transferencia" ? o.metodo_pago : "efectivo";
    const pagoRaw = (o.pago ?? null) as Record<string, unknown> | null;
    const str = (v: unknown) => (v == null || v === "" ? null : String(v).slice(0, 2000));
    const pago = pagoRaw ? {
      referencia: str(pagoRaw.referencia),
      entidad: str(pagoRaw.entidad),
      tipo_tarjeta: str(pagoRaw.tipo_tarjeta),
      cuenta_bancaria_id: str(pagoRaw.cuenta_bancaria_id),
      fecha_pago: str(pagoRaw.fecha_pago),
      observacion: str(pagoRaw.observacion),
    } : null;

    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const result = await facturarSesionPg({
      schema, empresaId: auth.empresa_id, sesionId: id,
      metodoPago, usuarioId: auth.usuarioCatalogId ?? null, pago,
    });
    return NextResponse.json(successResponse(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo facturar la mesa.";
    const status =
      msg.includes("abrir caja") || msg.includes("no tiene productos") || msg.includes("cancelada") || msg.includes("se está facturando")
        ? 409
        : msg.includes("no encontrada")
        ? 404
        : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
