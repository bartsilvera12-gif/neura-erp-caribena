/**
 * PG directo para Compras. Mismo patron que productos-pg / proveedores-pg:
 * pool singleton + queries parametrizadas + identifier escape.
 *
 * insertCompra realiza la operacion en transaccion:
 *   1) inserta compra con numero_control generado por secuencia local
 *   2) inserta movimiento ENTRADA (origen=compra) con audit
 *   3) actualiza producto.precio_venta + costo_promedio + stock_actual
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface CompraRow {
  id: string;
  empresa_id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: string | number;
  moneda: string;
  tipo_cambio: string | number;
  costo_unitario_original: string | number;
  costo_unitario: string | number;
  iva_tipo: string;
  subtotal: string | number;
  monto_iva: string | number;
  total: string | number;
  precio_venta: string | number;
  margen_venta: string | number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  numero_control: string;
  estado: string;
  fecha: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  usuario_nombre: string | null;
}

const COLS = `
  id, empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
  cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
  iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
  tipo_pago, plazo_dias, nro_timbrado, numero_control, estado, fecha,
  created_at, updated_at, created_by, usuario_nombre
`;

export interface InsertCompraInput {
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  moneda: string;
  tipo_cambio: number;
  costo_unitario_original: number;
  costo_unitario: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  margen_venta: number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  created_by: string | null;
  usuario_nombre: string | null;
}

export async function listCompras(
  schemaRaw: string,
  empresaId: string
): Promise<CompraRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "compras");
  const { rows } = await pool().query<CompraRow>(
    `SELECT ${COLS} FROM ${t} WHERE empresa_id = $1::uuid ORDER BY fecha DESC LIMIT 500`,
    [empresaId]
  );
  return rows;
}

/** Genera proximo COMP-XXXXXX leyendo el maximo existente. */
async function nextNumeroControl(
  client: import("pg").PoolClient,
  schema: string,
  empresaId: string
): Promise<string> {
  const t = quoteSchemaTable(schema, "compras");
  const { rows } = await client.query<{ maxn: number | null }>(
    `SELECT COALESCE(MAX(
       CASE WHEN numero_control ~ '^COMP-[0-9]+$'
            THEN (substring(numero_control from 6))::int
            ELSE 0 END
     ), 0) AS maxn
     FROM ${t} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  const next = Number(rows[0]?.maxn ?? 0) + 1;
  return `COMP-${String(next).padStart(6, "0")}`;
}

export interface CompraResult {
  compra: CompraRow;
  movimiento_id: string | null;
  movimiento_warning: string | null;
}

export async function insertCompraConImpacto(
  schemaRaw: string,
  empresaId: string,
  d: InsertCompraInput
): Promise<CompraResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");

  const client = await pool().connect();
  let movimientoId: string | null = null;
  let movimientoWarning: string | null = null;
  try {
    await client.query("BEGIN");

    const numero = await nextNumeroControl(client, schema, empresaId);

    const { rows: compraRows } = await client.query<CompraRow>(
      `INSERT INTO ${tC} (
         empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
         cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
         iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
         tipo_pago, plazo_dias, nro_timbrado, numero_control, estado, fecha,
         created_by, usuario_nombre
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, $5,
         $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
         $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
         $17, $18::integer, $19, $20, 'registrada', now(),
         $21::uuid, $22
       )
       RETURNING ${COLS}`,
      [
        empresaId,
        d.proveedor_id,
        d.proveedor_nombre,
        d.producto_id,
        d.producto_nombre,
        d.cantidad,
        d.moneda,
        d.tipo_cambio,
        d.costo_unitario_original,
        d.costo_unitario,
        d.iva_tipo,
        d.subtotal,
        d.monto_iva,
        d.total,
        d.precio_venta,
        d.margen_venta,
        d.tipo_pago,
        d.plazo_dias,
        d.nro_timbrado,
        numero,
        d.created_by,
        d.usuario_nombre,
      ]
    );
    const compra = compraRows[0];

    // Movimiento ENTRADA (origen=compra). Best-effort: si falla, la compra
    // queda registrada pero anunciamos warning.
    try {
      const { rows: movRows } = await client.query<{ id: string }>(
        `INSERT INTO ${tM} (
           empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha,
           created_by, usuario_nombre
         )
         SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku, ''),
                'ENTRADA', $4::numeric, $5::numeric, 'compra', $6, now(),
                $7::uuid, $8
         FROM ${tP} p WHERE p.id = $2::uuid
         RETURNING id`,
        [
          empresaId,
          d.producto_id,
          d.producto_nombre,
          d.cantidad,
          d.costo_unitario,
          numero,
          d.created_by,
          d.usuario_nombre,
        ]
      );
      movimientoId = movRows[0]?.id ?? null;
    } catch (movErr) {
      const msg = movErr instanceof Error ? movErr.message : String(movErr);
      console.error("[compras-pg] movimiento ENTRADA fallo", {
        schema, empresaId, numero, message: msg,
        code: (movErr as { code?: string })?.code,
        detail: (movErr as { detail?: string })?.detail,
      });
      movimientoWarning =
        "La compra se guardó pero no se pudo registrar el movimiento de entrada en inventario.";
    }

    // Actualizar producto: stock + costo_promedio + precio_venta
    await client.query(
      `UPDATE ${tP}
          SET stock_actual = stock_actual + $1::numeric,
              costo_promedio = $2::numeric,
              precio_venta = $3::numeric,
              updated_at = now()
        WHERE id = $4::uuid AND empresa_id = $5::uuid`,
      [d.cantidad, d.costo_unitario, d.precio_venta, d.producto_id, empresaId]
    );

    await client.query("COMMIT");
    return { compra, movimiento_id: movimientoId, movimiento_warning: movimientoWarning };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

export async function getCompraById(
  schemaRaw: string,
  empresaId: string,
  id: string
): Promise<CompraRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "compras");
  const { rows } = await pool().query<CompraRow>(
    `SELECT ${COLS} FROM ${t} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
    [id, empresaId]
  );
  return rows[0] ?? null;
}

/** Campos administrativos de una compra: no alteran stock ni costos. */
export interface UpdateCompraInput {
  tipo_pago?: string;
  plazo_dias?: number | null;
  nro_timbrado?: string;
  proveedor_id?: string;
  proveedor_nombre?: string;
  fecha?: string;
}

/**
 * Edita solo los campos administrativos.
 *
 * Cantidad, costo y precio quedan deliberadamente fuera: ya impactaron el stock
 * y el costo promedio del producto, así que cambiarlos "en el papel" dejaría el
 * inventario mintiendo. Para corregir esos valores hay que borrar la compra
 * (lo que revierte el movimiento) y cargarla de nuevo.
 */
export async function updateCompraCampos(
  schemaRaw: string,
  empresaId: string,
  id: string,
  d: UpdateCompraInput
): Promise<CompraRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "compras");

  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (frag: string, v: unknown) => { vals.push(v); sets.push(frag.replace("$?", `$${vals.length}`)); };

  if (d.tipo_pago !== undefined) push("tipo_pago = $?", d.tipo_pago);
  if (d.plazo_dias !== undefined) push("plazo_dias = $?::integer", d.plazo_dias);
  if (d.nro_timbrado !== undefined) push("nro_timbrado = $?", d.nro_timbrado);
  if (d.proveedor_id !== undefined) push("proveedor_id = $?::uuid", d.proveedor_id);
  if (d.proveedor_nombre !== undefined) push("proveedor_nombre = $?", d.proveedor_nombre);
  if (d.fecha !== undefined) push("fecha = $?::timestamptz", d.fecha);

  if (sets.length === 0) return getCompraById(schema, empresaId, id);

  sets.push("updated_at = now()");
  vals.push(id, empresaId);
  const { rows } = await pool().query<CompraRow>(
    `UPDATE ${t} SET ${sets.join(", ")}
      WHERE id = $${vals.length - 1}::uuid AND empresa_id = $${vals.length}::uuid
      RETURNING ${COLS}`,
    vals
  );
  return rows[0] ?? null;
}

export interface BorradoCompraResult {
  borrada: boolean;
  stock_revertido: number;
  movimientos_borrados: number;
  /** El costo promedio y el precio de venta que la compra pisó no se pueden reconstruir. */
  advertencia: string | null;
}

/**
 * Borra una compra revirtiendo lo que hizo al registrarse.
 *
 * Todo en una transacción, y en orden inverso al alta:
 *   1) descuenta del stock la cantidad que había entrado
 *   2) borra el movimiento ENTRADA que la compra generó
 *   3) borra la compra
 *
 * Lo que NO se puede revertir: al registrarse, la compra pisó `costo_promedio` y
 * `precio_venta` del producto con sus propios valores, y los anteriores no se
 * guardaron en ningún lado. Quedan como están y se avisa al usuario — es
 * preferible a inventar un valor.
 */
export async function deleteCompraConReversa(
  schemaRaw: string,
  empresaId: string,
  id: string
): Promise<BorradoCompraResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    const { rows: compraRows } = await client.query<CompraRow>(
      `SELECT ${COLS} FROM ${tC}
        WHERE id = $1::uuid AND empresa_id = $2::uuid
        FOR UPDATE`,
      [id, empresaId]
    );
    const compra = compraRows[0];
    if (!compra) {
      await client.query("ROLLBACK");
      return { borrada: false, stock_revertido: 0, movimientos_borrados: 0, advertencia: null };
    }

    const cantidad = Number(compra.cantidad) || 0;

    // El stock puede quedar en negativo si ya se vendió lo que entró con esta
    // compra. Se permite a propósito: un stock negativo es visible y se corrige,
    // mientras que truncar a cero escondería el faltante.
    await client.query(
      `UPDATE ${tP}
          SET stock_actual = stock_actual - $1::numeric,
              updated_at = now()
        WHERE id = $2::uuid AND empresa_id = $3::uuid`,
      [cantidad, compra.producto_id, empresaId]
    );

    const del = await client.query(
      `DELETE FROM ${tM}
        WHERE empresa_id = $1::uuid
          AND origen = 'compra'
          AND referencia = $2
          AND producto_id = $3::uuid`,
      [empresaId, compra.numero_control, compra.producto_id]
    );

    await client.query(
      `DELETE FROM ${tC} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [id, empresaId]
    );

    await client.query("COMMIT");

    return {
      borrada: true,
      stock_revertido: cantidad,
      movimientos_borrados: del.rowCount ?? 0,
      advertencia:
        "El costo promedio y el precio de venta del producto quedaron como los dejó esta compra: no se guardan los valores anteriores. Revisalos si hace falta.",
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}
