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
    const documento = texto(body.documento);
    const razonSocial = texto(body.razon_social);

    // El documento electrónico siempre lleva identificación del receptor: sin
    // RUC ni cédula el armador del XML no puede construirlo. Una venta sin
    // datos del cliente se cobra con ticket, no con factura.
    if (!ruc && !documento) {
      return NextResponse.json(
        errorResponse("Para facturar hace falta el RUC o la cédula del cliente."),
        { status: 400 }
      );
    }
    if (!razonSocial) {
      return NextResponse.json(
        errorResponse("Falta el nombre o razón social del cliente."),
        { status: 400 }
      );
    }
    // RUC y cédula juntos son dos receptores distintos: con RUC el documento
    // sale como contribuyente y con cédula como consumidor final identificado.
    if (ruc && documento) {
      return NextResponse.json(
        errorResponse("Elegí RUC o cédula, no los dos."),
        { status: 400 }
      );
    }

    const out = await facturarVentaPg(schema, tenant.auth.empresa_id, {
      ventaId: id,
      razonSocial,
      ruc,
      documento,
      clienteId: texto(body.cliente_id),
      guardarCliente: body.guardar_cliente === true,
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
