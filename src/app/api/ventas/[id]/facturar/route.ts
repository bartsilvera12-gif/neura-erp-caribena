import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { facturarVentaPg, FacturarVentaError } from "@/lib/facturacion/server/facturar-venta-pg";

/**
 * POST /api/ventas/[id]/facturar
 *
 * Emite la factura del ERP para una venta ya cobrada. Se llama cuando el
 * cliente pide factura, no en cada venta: ver el porqué en facturar-venta-pg.
 *
 * Devuelve el id de la factura para que la UI lleve al detalle, donde está el
 * panel que firma y envía el documento al SET.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await getTenantSupabaseFromAuth(request);
    if (!tenant) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await ctx.params;
    const schema = await fetchDataSchemaForEmpresaId(tenant.auth.empresa_id);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const texto = (v: unknown) =>
      typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 250) : null;

    const ruc = texto(body.ruc);
    const razonSocial = texto(body.razon_social);

    // El RUC sin razón social deja el documento a medias, y el SET lo rechaza.
    // Sin ninguno de los dos es consumidor final, que sí es válido.
    if (ruc && !razonSocial) {
      return NextResponse.json(
        errorResponse("Falta la razón social del cliente."),
        { status: 400 }
      );
    }

    const out = await facturarVentaPg(schema, tenant.auth.empresa_id, {
      ventaId: id,
      razonSocial,
      ruc,
      clienteId: texto(body.cliente_id),
    });

    return NextResponse.json(successResponse(out));
  } catch (err) {
    if (err instanceof FacturarVentaError) {
      return NextResponse.json(
        { success: false, error: err.message, data: { factura_id: err.facturaId } },
        { status: err.codigo === "ya_facturada" ? 409 : 400 }
      );
    }
    console.error("[/api/ventas/[id]/facturar]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo emitir la factura."), { status: 500 });
  }
}
