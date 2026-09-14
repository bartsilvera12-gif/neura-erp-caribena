import { NextRequest, NextResponse } from "next/server";
import { requireModule } from "@/lib/middleware/require-module";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getSesionDetallePg } from "@/lib/mesas/server/mesas-pg";
import { buildPrecuentaDocument } from "@/lib/mesas/server/ticket-precuenta";

/**
 * GET /api/mesas/sesiones/[id]/precuenta?w=58|80 — precuenta imprimible (HTML).
 *
 * SOLO lectura. NO registra venta, pago, ni cambia el estado de la sesión: es
 * el papel informativo que se entrega al cliente antes de que elija medio de
 * pago. Puede llamarse tantas veces como haga falta.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireModule(request, "mesas");
  if (!gate.ok) return new NextResponse("No autorizado", { status: gate.status });
  const { id } = await ctx.params;
  const schema = await fetchDataSchemaForEmpresaId(gate.auth.empresa_id);
  const detalle = await getSesionDetallePg(schema, gate.auth.empresa_id, id);
  if (!detalle || !detalle.sesion) {
    return new NextResponse("Cuenta no encontrada", { status: 404 });
  }

  const widthMm = new URL(request.url).searchParams.get("w") === "58" ? 58 : 80;
  const html = buildPrecuentaDocument(detalle, widthMm);
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
