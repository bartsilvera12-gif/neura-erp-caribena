import { NextRequest, NextResponse } from "next/server";
import { requireModule } from "@/lib/middleware/require-module";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { facturarSesionPg } from "@/lib/mesas/server/mesas-pg";
import { verificarClaveDescuentoPg } from "@/lib/ventas/server/descuento-clave-pg";
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
    const str = (v: unknown) => (v == null || v === "" ? null : String(v).slice(0, 2000));
    const METODOS = ["efectivo", "tarjeta", "transferencia", "qr"] as const;
    const metodoPago: (typeof METODOS)[number] =
      o.metodo_pago === "tarjeta" || o.metodo_pago === "transferencia" || o.metodo_pago === "qr"
        ? o.metodo_pago
        : "efectivo";

    // Cobro repartido: una línea por forma de pago. El total contra el que se
    // valida lo calcula el servidor a partir de los ítems de la sesión, así que
    // acá sólo se limpia la forma; la suma se verifica adentro de facturarSesionPg.
    const pagos = Array.isArray(o.pagos)
      ? (o.pagos as unknown[])
          .map((raw) => {
            const p = raw as Record<string, unknown>;
            const metodo = String(p.metodo_pago ?? "");
            const monto = Number(p.monto) || 0;
            if (!(METODOS as readonly string[]).includes(metodo) || monto <= 0) return null;
            return {
              metodo_pago: metodo as (typeof METODOS)[number],
              monto,
              referencia: str(p.referencia),
              cuenta_bancaria_id: str(p.cuenta_bancaria_id),
            };
          })
          .filter((p): p is NonNullable<typeof p> => p !== null)
      : [];
    const pagoRaw = (o.pago ?? null) as Record<string, unknown> | null;
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
      metodoPago, pagos, usuarioId: auth.usuarioCatalogId ?? null, pago,
    });
    return NextResponse.json(successResponse(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo facturar la mesa.";
    const status =
      msg.includes("abrir caja") || msg.includes("no tiene productos") || msg.includes("cancelada") || msg.includes("se está facturando") || msg.includes("El cobro suma")
        ? 409
        : msg.includes("no encontrada")
        ? 404
        : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
