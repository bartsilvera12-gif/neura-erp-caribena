/**
 * Convierte una venta ya cobrada en una factura del ERP, lista para emitirse
 * electrónicamente.
 *
 * Por qué a pedido y no automático: en un local de comida rápida la enorme
 * mayoría de los tickets son sin factura. Emitir un documento electrónico por
 * cada gaseosa significaría mandarle al SET miles de documentos que nadie pidió
 * y que después habría que cancelar de a uno. Así que la venta se cobra normal,
 * y sólo cuando el cliente pide factura se llama a esto con su RUC y razón
 * social.
 *
 * La factura toma el detalle de la venta tal como se cobró: mismos ítems, mismo
 * IVA por línea, mismo total. No recalcula nada — si el papel dijera otra cosa
 * que el ticket, el problema sería peor que no facturar.
 *
 * Todo va en una transacción: una factura sin sus ítems no sirve para armar el
 * XML, y una venta marcada como facturada sin factura sería mentira.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { Pool } from "pg";

function pool(): Pool {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de Postgres no disponible.");
  return p;
}

export class FacturarVentaError extends Error {
  constructor(
    public codigo:
      | "venta_inexistente"
      | "venta_anulada"
      | "ya_facturada"
      | "sin_items",
    message: string,
    /** Cuando ya estaba facturada, a dónde mandar al usuario. */
    public facturaId: string | null = null
  ) {
    super(message);
    this.name = "FacturarVentaError";
  }
}

export interface FacturarVentaInput {
  ventaId: string;
  /** Razón social del receptor. Vacío = consumidor final. */
  razonSocial: string | null;
  /** RUC con dígito verificador. Se usa para el receptor contribuyente. */
  ruc: string | null;
  /** Cédula, cuando la factura va a nombre de una persona sin RUC. */
  documento?: string | null;
  /** Cliente del ERP, si la venta se le atribuye a uno. */
  clienteId?: string | null;
}

export interface FacturarVentaResult {
  facturaId: string;
  numeroFactura: string;
  ventaId: string;
  total: number;
}

interface VentaRow {
  id: string;
  factura_id: string | null;
  estado: string;
  cliente_id: string | null;
  total: string | number;
  tipo_venta: string;
  moneda: string;
  observaciones: string | null;
  /** Día de la venta, ya formateado por la base como YYYY-MM-DD. */
  fecha_dia: string;
}

export async function facturarVentaPg(
  schemaRaw: string,
  empresaId: string,
  input: FacturarVentaInput
): Promise<FacturarVentaResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tF = quoteSchemaTable(schema, "facturas");
  const tFI = quoteSchemaTable(schema, "factura_items");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE: dos cajeros apretando "Facturar" sobre la misma venta al
    // mismo tiempo tienen que resolverse en serie, no crear dos facturas.
    const { rows: ventas } = await client.query<VentaRow>(
      `SELECT id, factura_id, estado, cliente_id, total, tipo_venta, moneda, observaciones,
              to_char(fecha, 'YYYY-MM-DD') AS fecha_dia
         FROM ${tV}
        WHERE id = $1::uuid AND empresa_id = $2::uuid
          FOR UPDATE`,
      [input.ventaId, empresaId]
    );
    const venta = ventas[0];
    if (!venta) {
      throw new FacturarVentaError("venta_inexistente", "La venta no existe.");
    }
    if (venta.estado === "anulada") {
      throw new FacturarVentaError("venta_anulada", "La venta está anulada: no se puede facturar.");
    }
    if (venta.factura_id) {
      throw new FacturarVentaError(
        "ya_facturada",
        "Esta venta ya tiene su factura.",
        venta.factura_id
      );
    }

    const { rows: items } = await client.query<{
      producto_nombre: string;
      item_display_name: string | null;
      cantidad: string | number;
      precio_venta: string | number;
      subtotal: string | number;
      monto_iva: string | number;
      total_linea: string | number;
      tipo_iva: string;
    }>(
      `SELECT producto_nombre, item_display_name, cantidad, precio_venta,
              subtotal, monto_iva, total_linea, tipo_iva
         FROM ${tVI}
        WHERE venta_id = $1::uuid AND empresa_id = $2::uuid
        ORDER BY created_at`,
      [input.ventaId, empresaId]
    );
    if (items.length === 0) {
      throw new FacturarVentaError("sin_items", "La venta no tiene productos para facturar.");
    }

    // Próximo FAC-XXXXXX. La transacción y el índice único por
    // (empresa_id, numero_factura) sostienen la unicidad.
    const { rows: maxRows } = await client.query<{ maxn: number | null }>(
      `SELECT COALESCE(MAX(
         CASE WHEN numero_factura ~ '^FAC-[0-9]+$'
              THEN (substring(numero_factura from 5))::int
              ELSE 0 END
       ), 0) AS maxn
       FROM ${tF} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    const numeroFactura = `FAC-${String(Number(maxRows[0]?.maxn ?? 0) + 1).padStart(6, "0")}`;

    const limpio = (v: string | null | undefined) =>
      typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    const fecha = venta.fecha_dia;
    const aCredito = venta.tipo_venta === "CREDITO";
    const total = Number(venta.total) || 0;

    const { rows: facRows } = await client.query<{ id: string }>(
      `INSERT INTO ${tF} (
         empresa_id, cliente_id, numero_factura, fecha, fecha_vencimiento,
         monto, saldo, estado, tipo, moneda,
         cliente_razon_social, cliente_ruc, cliente_documento, observaciones, origen_venta_id
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::date, $4::date,
         $5::numeric, $6::numeric, $7, $8, $9,
         $10, $11, $12, $13, $14::uuid
       ) RETURNING id`,
      [
        empresaId,
        input.clienteId ?? venta.cliente_id ?? null,
        numeroFactura,
        fecha,
        total,
        aCredito ? total : 0,
        aCredito ? "Pendiente" : "Pagado",
        aCredito ? "credito" : "contado",
        venta.moneda === "USD" ? "USD" : "GS",
        limpio(input.razonSocial),
        limpio(input.ruc),
        limpio(input.documento),
        limpio(venta.observaciones),
        venta.id,
      ]
    );
    const facturaId = facRows[0].id;

    // El nombre a mostrar prioriza el de la mitad y mitad: en el papel el
    // cliente tiene que leer lo mismo que pidió.
    for (const it of items) {
      await client.query(
        `INSERT INTO ${tFI} (
           empresa_id, factura_id, descripcion, cantidad, precio_unitario,
           subtotal, iva, total, tipo_iva
         ) VALUES ($1::uuid, $2::uuid, $3, $4::numeric, $5::numeric,
                   $6::numeric, $7::numeric, $8::numeric, $9)`,
        [
          empresaId,
          facturaId,
          limpio(it.item_display_name) ?? it.producto_nombre,
          Number(it.cantidad) || 0,
          Number(it.precio_venta) || 0,
          Number(it.subtotal) || 0,
          Number(it.monto_iva) || 0,
          Number(it.total_linea) || 0,
          it.tipo_iva,
        ]
      );
    }

    await client.query(
      `UPDATE ${tV} SET factura_id = $1::uuid, updated_at = now()
        WHERE id = $2::uuid AND empresa_id = $3::uuid`,
      [facturaId, venta.id, empresaId]
    );

    await client.query("COMMIT");
    return { facturaId, numeroFactura, ventaId: venta.id, total };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}
