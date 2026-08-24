import { randomUUID } from "node:crypto";
import { createServiceRoleClientWithDbSchema } from "@/lib/supabase/empresa-data-schema";
import { calcularLineaVenta } from "@/lib/ventas/iva";
import { getCajaAbiertaPg } from "@/lib/caja/server/caja-pg";
import {
  createVentaTransaccionalPg,
  type CreateVentaItemInput,
} from "@/lib/ventas/server/create-venta-pg";
import type {
  ComandaEnvioInfo,
  ComandaEnvioResult,
  Mesa,
  MesaConResumen,
  MesaDetalle,
  MesaSesion,
  MesaSesionItem,
  ParaLlevarConResumen,
} from "@/lib/mesas/types";

type Sb = ReturnType<typeof createServiceRoleClientWithDbSchema>;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const MESA_COLS = "id, numero, nombre, estado, activo";
const SESION_COLS =
  "id, mesa_id, tipo, numero_pl, nombre_cliente, estado, mozo_id, abierta_at, enviada_caja_at, cerrada_at, venta_id, observacion";
const ITEM_COLS =
  "id, sesion_id, producto_id, producto_nombre, sku, cantidad, precio_unitario, total, observacion, estado, comanda_id, enviado_at, es_mitad_mitad, mitad_1_nombre, mitad_2_nombre, item_display_name";

/** Estados de ítem que cuentan en la cuenta (todo menos cancelado). */
const ITEM_VIGENTES = ["pendiente", "enviado"];

function mapMesa(r: Record<string, unknown>): Mesa {
  return {
    id: String(r.id),
    numero: num(r.numero),
    nombre: (r.nombre as string) ?? null,
    estado: r.estado as Mesa["estado"],
    activo: r.activo !== false,
  };
}
function mapSesion(r: Record<string, unknown>): MesaSesion {
  return {
    id: String(r.id),
    mesa_id: r.mesa_id == null ? null : String(r.mesa_id),
    tipo: (r.tipo as MesaSesion["tipo"]) ?? "mesa",
    numero_pl: r.numero_pl == null ? null : Number(r.numero_pl),
    nombre_cliente: (r.nombre_cliente as string) ?? null,
    estado: r.estado as MesaSesion["estado"],
    mozo_id: (r.mozo_id as string) ?? null,
    abierta_at: r.abierta_at as string,
    enviada_caja_at: (r.enviada_caja_at as string) ?? null,
    cerrada_at: (r.cerrada_at as string) ?? null,
    venta_id: (r.venta_id as string) ?? null,
    observacion: (r.observacion as string) ?? null,
  };
}
function mapItem(r: Record<string, unknown>): MesaSesionItem {
  return {
    id: String(r.id),
    sesion_id: String(r.sesion_id),
    producto_id: String(r.producto_id),
    producto_nombre: (r.producto_nombre as string) ?? "",
    sku: (r.sku as string) ?? null,
    cantidad: num(r.cantidad),
    precio_unitario: num(r.precio_unitario),
    total: num(r.total),
    observacion: (r.observacion as string) ?? null,
    estado: r.estado as MesaSesionItem["estado"],
    comanda_id: (r.comanda_id as string) ?? null,
    enviado_at: (r.enviado_at as string) ?? null,
    es_mitad_mitad: r.es_mitad_mitad === true,
    mitad_1_nombre: (r.mitad_1_nombre as string) ?? null,
    mitad_2_nombre: (r.mitad_2_nombre as string) ?? null,
    item_display_name: (r.item_display_name as string) ?? null,
  };
}

async function resolveMozoNombres(sb: Sb, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  try {
    const q = await sb.from("usuarios").select("id, nombre").in("id", uniq);
    if (!q.error) for (const u of (q.data ?? []) as Array<{ id: string; nombre: string | null }>) {
      if (u.nombre) out.set(u.id, u.nombre);
    }
  } catch { /* opcional */ }
  return out;
}

/** Totales de una sesión a partir de sus ítems activos. */
async function totalesPorSesion(sb: Sb, empresaId: string, sesionIds: string[]) {
  const totalBy = new Map<string, number>();
  const countBy = new Map<string, number>();
  if (!sesionIds.length) return { totalBy, countBy };
  const iQ = await sb
    .from("mesa_sesion_items")
    .select("sesion_id, total")
    .eq("empresa_id", empresaId)
    .in("estado", ITEM_VIGENTES)
    .in("sesion_id", sesionIds);
  if (iQ.error) throw new Error(iQ.error.message);
  for (const it of (iQ.data ?? []) as Array<{ sesion_id: string; total: number | string }>) {
    totalBy.set(it.sesion_id, (totalBy.get(it.sesion_id) ?? 0) + num(it.total));
    countBy.set(it.sesion_id, (countBy.get(it.sesion_id) ?? 0) + 1);
  }
  return { totalBy, countBy };
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

/** Todas las mesas (activas) con el resumen de su sesión viva. */
export async function listarMesasPg(schema: string, empresaId: string): Promise<MesaConResumen[]> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const mQ = await sb
    .from("mesas")
    .select(MESA_COLS)
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .order("numero", { ascending: true });
  if (mQ.error) throw new Error(mQ.error.message);
  const mesas = (mQ.data ?? []).map((r) => mapMesa(r as Record<string, unknown>));

  const sQ = await sb
    .from("mesa_sesiones")
    .select(SESION_COLS)
    .eq("empresa_id", empresaId)
    .eq("tipo", "mesa")
    .in("estado", ["abierta", "por_cobrar"]);
  if (sQ.error) throw new Error(sQ.error.message);
  const sesiones = (sQ.data ?? []).map((r) => mapSesion(r as Record<string, unknown>));
  const sesionByMesa = new Map(sesiones.filter((s) => s.mesa_id).map((s) => [s.mesa_id as string, s]));

  const { totalBy, countBy } = await totalesPorSesion(sb, empresaId, sesiones.map((s) => s.id));
  const mozoNombres = await resolveMozoNombres(sb, sesiones.map((s) => s.mozo_id ?? "").filter(Boolean));

  return mesas.map((mesa) => {
    const sesion = sesionByMesa.get(mesa.id) ?? null;
    return {
      mesa,
      sesion,
      total: sesion ? totalBy.get(sesion.id) ?? 0 : 0,
      items_count: sesion ? countBy.get(sesion.id) ?? 0 : 0,
      mozo_nombre: sesion?.mozo_id ? mozoNombres.get(sesion.mozo_id) ?? null : null,
    };
  });
}

/** Detalle de una mesa: sesión viva + ítems activos. */
export async function getMesaDetallePg(
  schema: string,
  empresaId: string,
  mesaId: string
): Promise<MesaDetalle | null> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const mQ = await sb.from("mesas").select(MESA_COLS).eq("empresa_id", empresaId).eq("id", mesaId).maybeSingle();
  if (mQ.error) throw new Error(mQ.error.message);
  if (!mQ.data) return null;
  const mesa = mapMesa(mQ.data as Record<string, unknown>);

  const sQ = await sb
    .from("mesa_sesiones")
    .select(SESION_COLS)
    .eq("empresa_id", empresaId)
    .eq("mesa_id", mesaId)
    .in("estado", ["abierta", "por_cobrar"])
    .maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  const sesion = sQ.data ? mapSesion(sQ.data as Record<string, unknown>) : null;

  let items: MesaSesionItem[] = [];
  if (sesion) {
    const iQ = await sb
      .from("mesa_sesion_items")
      .select(ITEM_COLS)
      .eq("empresa_id", empresaId)
      .eq("sesion_id", sesion.id)
      .in("estado", ITEM_VIGENTES)
      .order("created_at", { ascending: true });
    if (iQ.error) throw new Error(iQ.error.message);
    items = (iQ.data ?? []).map((r) => mapItem(r as Record<string, unknown>));
  }
  const total = items.reduce((s, it) => s + it.total, 0);
  return { mesa, sesion, items, total };
}

/** Sesiones por cobrar (lista para caja). */
export async function listarPorCobrarPg(schema: string, empresaId: string): Promise<MesaConResumen[]> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const sQ = await sb
    .from("mesa_sesiones")
    .select(SESION_COLS)
    .eq("empresa_id", empresaId)
    .eq("tipo", "mesa")
    .eq("estado", "por_cobrar")
    .order("enviada_caja_at", { ascending: true });
  if (sQ.error) throw new Error(sQ.error.message);
  const sesiones = (sQ.data ?? []).map((r) => mapSesion(r as Record<string, unknown>));
  if (!sesiones.length) return [];

  const mesaIds = [...new Set(sesiones.map((s) => s.mesa_id).filter((id): id is string => !!id))];
  const mQ = await sb.from("mesas").select(MESA_COLS).eq("empresa_id", empresaId).in("id", mesaIds);
  if (mQ.error) throw new Error(mQ.error.message);
  const mesaById = new Map(((mQ.data ?? []).map((r) => mapMesa(r as Record<string, unknown>))).map((m) => [m.id, m]));

  const { totalBy, countBy } = await totalesPorSesion(sb, empresaId, sesiones.map((s) => s.id));
  const mozoNombres = await resolveMozoNombres(sb, sesiones.map((s) => s.mozo_id ?? "").filter(Boolean));

  return sesiones.map((sesion) => {
    const m: Mesa | undefined = sesion.mesa_id ? mesaById.get(sesion.mesa_id) : undefined;
    const mesa: Mesa = m ?? {
      id: sesion.mesa_id ?? "",
      numero: 0,
      nombre: null,
      estado: "por_cobrar",
      activo: true,
    };
    return {
      mesa,
      sesion,
      total: totalBy.get(sesion.id) ?? 0,
      items_count: countBy.get(sesion.id) ?? 0,
      mozo_nombre: sesion.mozo_id ? mozoNombres.get(sesion.mozo_id) ?? null : null,
    };
  });
}

// ── PARA LLEVAR ───────────────────────────────────────────────────────────────

/** Crea una sesión "Para llevar" (sin mesa) con correlativo PL autogenerado. */
export async function abrirSesionParaLlevarPg(
  schema: string,
  empresaId: string,
  mozoId: string | null,
  nombreCliente: string | null
): Promise<MesaSesion> {
  const sb = createServiceRoleClientWithDbSchema(schema);

  // Correlativo atómico (arranca en 1, nunca resetea).
  const rpc = await sb.rpc("next_para_llevar_numero", { p_empresa_id: empresaId });
  if (rpc.error) throw new Error(rpc.error.message);
  const numeroPl = Number(rpc.data);
  if (!Number.isFinite(numeroPl) || numeroPl < 1) {
    throw new Error("No se pudo obtener el correlativo Para llevar.");
  }

  const nombre = (nombreCliente ?? "").trim() || null;

  const ins = await sb
    .from("mesa_sesiones")
    .insert({
      empresa_id: empresaId,
      mesa_id: null,
      tipo: "para_llevar",
      numero_pl: numeroPl,
      nombre_cliente: nombre,
      estado: "abierta",
      mozo_id: mozoId,
    })
    .select(SESION_COLS)
    .single();
  if (ins.error) throw new Error(ins.error.message);
  return mapSesion(ins.data as Record<string, unknown>);
}

/** Lista sesiones PARA LLEVAR vivas (abierta/por_cobrar) con resumen para el sidebar. */
export async function listarParaLlevarPg(
  schema: string,
  empresaId: string
): Promise<ParaLlevarConResumen[]> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const sQ = await sb
    .from("mesa_sesiones")
    .select(SESION_COLS)
    .eq("empresa_id", empresaId)
    .eq("tipo", "para_llevar")
    .in("estado", ["abierta", "por_cobrar"])
    .order("abierta_at", { ascending: true });
  if (sQ.error) throw new Error(sQ.error.message);
  const sesiones = (sQ.data ?? []).map((r) => mapSesion(r as Record<string, unknown>));
  if (!sesiones.length) return [];

  const { totalBy, countBy } = await totalesPorSesion(sb, empresaId, sesiones.map((s) => s.id));
  const mozoNombres = await resolveMozoNombres(sb, sesiones.map((s) => s.mozo_id ?? "").filter(Boolean));

  return sesiones.map((sesion) => ({
    sesion,
    total: totalBy.get(sesion.id) ?? 0,
    items_count: countBy.get(sesion.id) ?? 0,
    mozo_nombre: sesion.mozo_id ? mozoNombres.get(sesion.mozo_id) ?? null : null,
  }));
}

/** Detalle completo de una sesión PL por su sesion_id (ítems activos). */
export async function getParaLlevarDetallePg(
  schema: string,
  empresaId: string,
  sesionId: string
): Promise<{ sesion: MesaSesion; items: MesaSesionItem[]; total: number } | null> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const sQ = await sb
    .from("mesa_sesiones")
    .select(SESION_COLS)
    .eq("empresa_id", empresaId)
    .eq("id", sesionId)
    .eq("tipo", "para_llevar")
    .maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  if (!sQ.data) return null;
  const sesion = mapSesion(sQ.data as Record<string, unknown>);

  const iQ = await sb
    .from("mesa_sesion_items")
    .select(ITEM_COLS)
    .eq("empresa_id", empresaId)
    .eq("sesion_id", sesion.id)
    .in("estado", ITEM_VIGENTES)
    .order("created_at", { ascending: true });
  if (iQ.error) throw new Error(iQ.error.message);
  const items = (iQ.data ?? []).map((r) => mapItem(r as Record<string, unknown>));
  const total = items.reduce((s, it) => s + it.total, 0);
  return { sesion, items, total };
}

// ── Escrituras ────────────────────────────────────────────────────────────────

/** Devuelve la sesión viva de la mesa o crea una nueva (mesa → ocupada). */
async function ensureSesionAbierta(
  sb: Sb,
  empresaId: string,
  mesaId: string,
  mozoId: string | null
): Promise<MesaSesion> {
  const existing = await sb
    .from("mesa_sesiones")
    .select(SESION_COLS)
    .eq("empresa_id", empresaId)
    .eq("mesa_id", mesaId)
    .in("estado", ["abierta", "por_cobrar"])
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return mapSesion(existing.data as Record<string, unknown>);

  const ins = await sb
    .from("mesa_sesiones")
    .insert({ empresa_id: empresaId, mesa_id: mesaId, estado: "abierta", mozo_id: mozoId })
    .select(SESION_COLS)
    .single();
  if (ins.error) {
    if (ins.error.code === "23505") {
      // Carrera: otra request creó la sesión; devolvemos la viva.
      const again = await sb
        .from("mesa_sesiones").select(SESION_COLS)
        .eq("empresa_id", empresaId).eq("mesa_id", mesaId)
        .in("estado", ["abierta", "por_cobrar"]).maybeSingle();
      if (again.data) return mapSesion(again.data as Record<string, unknown>);
    }
    throw new Error(ins.error.message);
  }
  await sb.from("mesas").update({ estado: "ocupada" }).eq("empresa_id", empresaId).eq("id", mesaId);
  return mapSesion(ins.data as Record<string, unknown>);
}

export async function abrirMesaPg(
  schema: string,
  empresaId: string,
  mesaId: string,
  mozoId: string | null
): Promise<MesaSesion> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  return ensureSesionAbierta(sb, empresaId, mesaId, mozoId);
}

/** Metadata de pizza mitad y mitad para inserción de un ítem. */
export interface MitadMitadInput {
  producto1Id: string | null;
  producto2Id: string | null;
  nombre1: string | null;
  nombre2: string | null;
}
/** Columnas mitad-mitad para el insert de un mesa_sesion_item. */
function mitadInsertCols(displayName: string | null, mitad: MitadMitadInput | null | undefined) {
  return {
    es_mitad_mitad: !!mitad,
    mitad_1_producto_id: mitad?.producto1Id ?? null,
    mitad_2_producto_id: mitad?.producto2Id ?? null,
    mitad_1_nombre: mitad?.nombre1 ?? null,
    mitad_2_nombre: mitad?.nombre2 ?? null,
    item_display_name: displayName ?? null,
  };
}

export async function agregarItemPg(params: {
  schema: string;
  empresaId: string;
  mesaId: string;
  productoId: string;
  cantidad: number;
  observacion: string | null;
  creadoPor: string | null;
  /** Precio unitario override (pizza mitad y mitad = max de ambos sabores). */
  precioUnitario?: number | null;
  /** Nombre a mostrar (ej. "Pizza mitad y mitad"). */
  displayName?: string | null;
  mitad?: MitadMitadInput | null;
}): Promise<MesaSesionItem> {
  const sb = createServiceRoleClientWithDbSchema(params.schema);
  const sesion = await ensureSesionAbierta(sb, params.empresaId, params.mesaId, params.creadoPor);
  if (sesion.estado !== "abierta") {
    throw new Error("La cuenta ya fue enviada a caja; no se pueden agregar más productos.");
  }

  const pQ = await sb
    .from("productos")
    .select("id, nombre, sku, precio_venta")
    .eq("empresa_id", params.empresaId)
    .eq("id", params.productoId)
    .maybeSingle();
  if (pQ.error) throw new Error(pQ.error.message);
  if (!pQ.data) throw new Error("Producto no encontrado en esta empresa.");
  const prod = pQ.data as { nombre: string; sku: string | null; precio_venta: number | string };

  const cantidad = num(params.cantidad);
  if (cantidad <= 0) throw new Error("La cantidad debe ser mayor a 0.");
  const precioOverride = params.precioUnitario != null ? num(params.precioUnitario) : 0;
  const precio = precioOverride > 0 ? precioOverride : num(prod.precio_venta);
  const total = Math.round(precio * cantidad);

  const ins = await sb
    .from("mesa_sesion_items")
    .insert({
      empresa_id: params.empresaId,
      sesion_id: sesion.id,
      producto_id: params.productoId,
      producto_nombre: params.displayName || prod.nombre,
      sku: prod.sku,
      cantidad,
      precio_unitario: precio,
      total,
      observacion: params.observacion,
      estado: "pendiente",
      creado_por: params.creadoPor,
      ...mitadInsertCols(params.displayName ?? null, params.mitad),
    })
    .select(ITEM_COLS)
    .single();
  if (ins.error) throw new Error(ins.error.message);
  // Asegurar mesa ocupada (por si venía 'libre' y la sesión ya existía).
  await sb.from("mesas").update({ estado: "ocupada" }).eq("empresa_id", params.empresaId).eq("id", params.mesaId).eq("estado", "libre");
  return mapItem(ins.data as Record<string, unknown>);
}

export async function actualizarItemPg(params: {
  schema: string;
  empresaId: string;
  itemId: string;
  cantidad?: number;
  observacion?: string | null;
  cancelar?: boolean;
}): Promise<MesaSesionItem> {
  const sb = createServiceRoleClientWithDbSchema(params.schema);
  const cur = await sb
    .from("mesa_sesion_items")
    .select("id, precio_unitario, cantidad, sesion_id, estado")
    .eq("empresa_id", params.empresaId)
    .eq("id", params.itemId)
    .maybeSingle();
  if (cur.error) throw new Error(cur.error.message);
  if (!cur.data) throw new Error("Ítem no encontrado.");
  const row = cur.data as { precio_unitario: number | string; cantidad: number | string; estado: string };
  if (row.estado === "cancelado") throw new Error("El producto ya fue cancelado.");

  const patch: Record<string, unknown> = {};
  if (params.cancelar) {
    // Cancelar se permite en pendiente y enviado (no impacta stock/caja).
    patch.estado = "cancelado";
  } else {
    // Editar cantidad/observación solo si el ítem aún NO fue enviado a comanda.
    if (row.estado !== "pendiente") {
      throw new Error("El producto ya fue enviado a comanda; no se puede editar.");
    }
    if (params.cantidad != null) {
      const c = num(params.cantidad);
      if (c <= 0) throw new Error("La cantidad debe ser mayor a 0.");
      patch.cantidad = c;
      patch.total = Math.round(num(row.precio_unitario) * c);
    }
    if (params.observacion !== undefined) patch.observacion = params.observacion;
  }
  if (Object.keys(patch).length === 0) throw new Error("Nada para actualizar.");

  const upd = await sb
    .from("mesa_sesion_items")
    .update(patch)
    .eq("empresa_id", params.empresaId)
    .eq("id", params.itemId)
    .select(ITEM_COLS)
    .single();
  if (upd.error) throw new Error(upd.error.message);
  return mapItem(upd.data as Record<string, unknown>);
}

/** Envía la cuenta a caja: sesión y mesa → por_cobrar. */
export async function enviarACajaPg(schema: string, empresaId: string, mesaId: string): Promise<MesaSesion> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const sQ = await sb
    .from("mesa_sesiones").select(SESION_COLS)
    .eq("empresa_id", empresaId).eq("mesa_id", mesaId).eq("estado", "abierta").maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  if (!sQ.data) throw new Error("La mesa no tiene una cuenta abierta para enviar a caja.");
  const sesion = mapSesion(sQ.data as Record<string, unknown>);

  const cnt = await sb
    .from("mesa_sesion_items").select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId).eq("sesion_id", sesion.id).in("estado", ITEM_VIGENTES);
  if ((cnt.count ?? 0) === 0) throw new Error("La cuenta no tiene productos.");

  const upd = await sb
    .from("mesa_sesiones")
    .update({ estado: "por_cobrar", enviada_caja_at: new Date().toISOString() })
    .eq("empresa_id", empresaId).eq("id", sesion.id).eq("estado", "abierta")
    .select(SESION_COLS).single();
  if (upd.error) throw new Error(upd.error.message);
  await sb.from("mesas").update({ estado: "por_cobrar" }).eq("empresa_id", empresaId).eq("id", mesaId);
  return mapSesion(upd.data as Record<string, unknown>);
}

/** Sector de producción de un set de productos (productos.sector_produccion). */
async function sectoresDeProductos(
  sb: Sb, empresaId: string, ids: string[]
): Promise<Map<string, "pizzeria" | "plancha" | null>> {
  const out = new Map<string, "pizzeria" | "plancha" | null>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const q = await sb.from("productos").select("id, sector_produccion").eq("empresa_id", empresaId).in("id", uniq);
  for (const r of (q.data ?? []) as Array<{ id: string; sector_produccion: string | null }>) {
    const s = r.sector_produccion;
    out.set(r.id, s === "pizzeria" || s === "plancha" ? s : null);
  }
  return out;
}

/**
 * Envía a PRODUCCIÓN los ítems pendientes de una sesión, generando comandas por
 * sector dentro de un mismo batch:
 *  · pizzería → copia completa del batch (todos los ítems del envío).
 *  · plancha  → solo los ítems de plancha.
 *  · bebidas / 'ninguno' → no generan comanda.
 * Marca TODOS los pendientes como enviados (con produccion_batch_id) para no
 * reimprimir producción al facturar. Idempotente respecto de ítems ya enviados.
 */
async function enviarProduccionDeSesion(
  sb: Sb, empresaId: string, sesionId: string, usuarioId: string | null
): Promise<ComandaEnvioResult> {
  const pQ = await sb
    .from("mesa_sesion_items").select("id, producto_id")
    .eq("empresa_id", empresaId).eq("sesion_id", sesionId).eq("estado", "pendiente");
  if (pQ.error) throw new Error(pQ.error.message);
  const pendientes = (pQ.data ?? []) as Array<{ id: string; producto_id: string }>;
  if (pendientes.length === 0) return { comandas: [], sin_produccion: false, total_pendientes: 0 };

  const sectores = await sectoresDeProductos(sb, empresaId, pendientes.map((p) => p.producto_id));
  const hayPizzeria = pendientes.some((p) => sectores.get(p.producto_id) === "pizzeria");
  const hayPlancha = pendientes.some((p) => sectores.get(p.producto_id) === "plancha");

  const batchId = randomUUID();
  const nowIso = new Date().toISOString();
  const creadas: ComandaEnvioInfo[] = [];

  if (hayPizzeria || hayPlancha) {
    // Número secuencial por sesión (una por sector dentro del batch).
    const maxQ = await sb.from("comandas").select("numero")
      .eq("empresa_id", empresaId).eq("sesion_id", sesionId)
      .order("numero", { ascending: false }).limit(1);
    if (maxQ.error) throw new Error(maxQ.error.message);
    let numero = num((maxQ.data?.[0] as { numero?: number } | undefined)?.numero);

    const planchaCount = pendientes.filter((p) => sectores.get(p.producto_id) === "plancha").length;
    const sectoresACrear: Array<{ sector: "pizzeria" | "plancha"; count: number }> = [];
    if (hayPizzeria) sectoresACrear.push({ sector: "pizzeria", count: pendientes.length }); // copia completa
    if (hayPlancha) sectoresACrear.push({ sector: "plancha", count: planchaCount });

    for (const s of sectoresACrear) {
      numero += 1;
      const ins = await sb.from("comandas")
        .insert({ empresa_id: empresaId, sesion_id: sesionId, numero, creado_por: usuarioId, sector: s.sector, batch_id: batchId })
        .select("id, numero").single();
      if (ins.error) throw new Error(ins.error.message);
      const row = ins.data as { id: string; numero: number };
      creadas.push({ id: row.id, numero: row.numero, sector: s.sector, items_count: s.count });
    }
  }

  // Comanda "primaria" para compatibilidad con comanda_id (pizzería si existe).
  const primaria = creadas.find((c) => c.sector === "pizzeria") ?? creadas[0] ?? null;
  const upd = await sb.from("mesa_sesion_items")
    .update({ estado: "enviado", comanda_id: primaria?.id ?? null, enviado_at: nowIso, produccion_batch_id: batchId })
    .eq("empresa_id", empresaId).eq("sesion_id", sesionId).eq("estado", "pendiente");
  if (upd.error) throw new Error(upd.error.message);

  return { comandas: creadas, sin_produccion: creadas.length === 0, total_pendientes: pendientes.length };
}

/**
 * Envía a COCINA los ítems pendientes de la mesa. La mesa sigue ocupada/abierta.
 * NO crea venta, NO toca caja ni stock. Genera comandas por sector (ver
 * enviarProduccionDeSesion).
 */
export async function enviarComandaPg(
  schema: string,
  empresaId: string,
  mesaId: string,
  usuarioId: string | null
): Promise<ComandaEnvioResult> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const sQ = await sb
    .from("mesa_sesiones").select("id, estado")
    .eq("empresa_id", empresaId).eq("mesa_id", mesaId).eq("estado", "abierta").maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  if (!sQ.data) throw new Error("La mesa no tiene una cuenta abierta.");
  const sesionId = (sQ.data as { id: string }).id;

  const result = await enviarProduccionDeSesion(sb, empresaId, sesionId, usuarioId);
  if (result.total_pendientes === 0) throw new Error("No hay productos nuevos para enviar a comanda.");
  return result;
}

/** Cancela la cuenta viva: sesión → cancelada, mesa → libre. */
export async function cancelarSesionPg(schema: string, empresaId: string, mesaId: string): Promise<void> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const sQ = await sb
    .from("mesa_sesiones").select("id, venta_id")
    .eq("empresa_id", empresaId).eq("mesa_id", mesaId).in("estado", ["abierta", "por_cobrar"]).maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  if (!sQ.data) throw new Error("La mesa no tiene una cuenta para cancelar.");
  if ((sQ.data as { venta_id: string | null }).venta_id) throw new Error("La cuenta ya fue facturada; no se puede cancelar.");
  const sesionId = (sQ.data as { id: string }).id;

  const upd = await sb
    .from("mesa_sesiones")
    .update({ estado: "cancelada", cerrada_at: new Date().toISOString() })
    .eq("empresa_id", empresaId).eq("id", sesionId).is("venta_id", null);
  if (upd.error) throw new Error(upd.error.message);
  await sb.from("mesas").update({ estado: "libre" }).eq("empresa_id", empresaId).eq("id", mesaId);
}

/**
 * Factura una sesión: crea la venta (reutilizando createVentaTransaccionalPg) y
 * la asocia a la caja abierta. IDEMPOTENTE: si la sesión ya tiene venta_id, la
 * devuelve sin crear otra. Exige caja abierta. Descuenta stock vía la lógica de
 * ventas (no antes).
 */
export async function facturarSesionPg(params: {
  schema: string;
  empresaId: string;
  sesionId: string;
  metodoPago: "efectivo" | "tarjeta" | "transferencia";
  usuarioId: string | null;
  /** Datos de conciliación para tarjeta/transferencia (estado inicial: pendiente). */
  pago?: {
    referencia?: string | null;
    entidad?: string | null;
    tipo_tarjeta?: string | null;
    cuenta_bancaria_id?: string | null;
    fecha_pago?: string | null;
    observacion?: string | null;
  } | null;
}): Promise<{ ventaId: string; numeroControl: string | null; yaFacturada: boolean }> {
  const sb = createServiceRoleClientWithDbSchema(params.schema);

  const sQ = await sb
    .from("mesa_sesiones").select("id, mesa_id, tipo, numero_pl, nombre_cliente, estado, venta_id")
    .eq("empresa_id", params.empresaId).eq("id", params.sesionId).maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  if (!sQ.data) throw new Error("Sesión de mesa no encontrada.");
  const ses = sQ.data as {
    id: string; mesa_id: string | null; tipo: "mesa" | "para_llevar";
    numero_pl: number | null; nombre_cliente: string | null;
    estado: string; venta_id: string | null;
  };

  // Idempotencia: ya facturada.
  if (ses.venta_id) return { ventaId: ses.venta_id, numeroControl: null, yaFacturada: true };
  if (ses.estado === "cancelada") throw new Error("La cuenta fue cancelada.");

  // Exigir caja abierta (igual que una venta normal).
  const caja = await getCajaAbiertaPg(params.schema, params.empresaId);
  if (!caja) throw new Error("Para vender primero tenés que abrir caja.");

  // Claim atómico: tomamos la sesión sólo si sigue viva y sin venta.
  const claim = await sb
    .from("mesa_sesiones")
    .update({ estado: "facturada", cerrada_at: new Date().toISOString() })
    .eq("empresa_id", params.empresaId).eq("id", ses.id)
    .is("venta_id", null).in("estado", ["abierta", "por_cobrar"])
    .select("id, mesa_id");
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data || claim.data.length === 0) {
    // Otra request la tomó: devolver la venta existente si ya está.
    const re = await sb.from("mesa_sesiones").select("venta_id").eq("id", ses.id).maybeSingle();
    const vid = (re.data as { venta_id: string | null } | null)?.venta_id ?? null;
    if (vid) return { ventaId: vid, numeroControl: null, yaFacturada: true };
    throw new Error("La mesa ya se está facturando. Reintentá en unos segundos.");
  }

  const revert = async () => {
    await sb.from("mesa_sesiones").update({ estado: "por_cobrar", cerrada_at: null })
      .eq("empresa_id", params.empresaId).eq("id", ses.id).is("venta_id", null);
  };

  try {
    // Producción de ítems agregados en caja y aún NO enviados (casos 7/8): genera
    // las comandas por sector que falten. No reimprime los ya enviados (dedup).
    // Best-effort: una falla acá no debe bloquear la venta.
    try {
      await enviarProduccionDeSesion(sb, params.empresaId, ses.id, params.usuarioId);
    } catch (e) {
      console.error("[facturarSesionPg] enviarProduccion:", e instanceof Error ? e.message : e);
    }

    // Ítems activos de la sesión.
    const iQ = await sb
      .from("mesa_sesion_items")
      .select("producto_id, producto_nombre, sku, cantidad, precio_unitario")
      .eq("empresa_id", params.empresaId).eq("sesion_id", ses.id).in("estado", ITEM_VIGENTES);
    if (iQ.error) throw new Error(iQ.error.message);
    const rows = (iQ.data ?? []) as Array<{
      producto_id: string; producto_nombre: string; sku: string | null;
      cantidad: number | string; precio_unitario: number | string;
    }>;
    if (!rows.length) throw new Error("La mesa no tiene productos para facturar.");

    // Construir ítems de venta (IVA INCLUIDO 10%, recalculado por la lógica de ventas).
    const items: CreateVentaItemInput[] = rows.map((r) => {
      const cantidad = num(r.cantidad);
      const precio = num(r.precio_unitario);
      const d = calcularLineaVenta(precio, cantidad, "10%");
      return {
        producto_id: r.producto_id,
        producto_nombre: r.producto_nombre,
        sku: r.sku ?? "",
        cantidad,
        precio_venta_original: precio,
        precio_venta: precio,
        tipo_iva: "10%",
        subtotal: d.subtotal,
        monto_iva: d.monto_iva,
        total_linea: d.total_linea,
      };
    });
    let sub = 0, iva = 0, tot = 0;
    for (const it of items) { sub += it.subtotal; iva += it.monto_iva; tot += it.total_linea; }

    // Nº de mesa o rótulo PARA LLEVAR para la observación.
    let observaciones: string;
    if (ses.tipo === "para_llevar") {
      const num = ses.numero_pl != null ? `PL-${String(ses.numero_pl).padStart(3, "0")}` : "PL";
      observaciones = ses.nombre_cliente ? `Para llevar ${num} · ${ses.nombre_cliente}` : `Para llevar ${num}`;
    } else {
      const mQ = ses.mesa_id ? await sb.from("mesas").select("numero").eq("id", ses.mesa_id).maybeSingle() : { data: null };
      const numeroMesa = (mQ.data as { numero: number } | null)?.numero ?? null;
      observaciones = numeroMesa != null ? `Mesa ${numeroMesa}` : "Mesa";
    }

    const { ventaId, numeroControl } = await createVentaTransaccionalPg({
      schema: params.schema,
      empresaId: params.empresaId,
      clienteId: null,
      observaciones,
      moneda: "GS",
      tipoCambio: 1,
      tipoVenta: "CONTADO",
      plazoDias: null,
      metodoPago: params.metodoPago,
      items,
      subtotalDeclarado: sub,
      montoIvaDeclarado: iva,
      totalDeclarado: tot,
      pedidoCocina: null, // la comida ya fue preparada/servida: no se crea comanda de cocina
      cajaId: caja.id,
    });

    // Persistir venta_id + liberar mesa (solo si tipo='mesa').
    const setVenta = await sb
      .from("mesa_sesiones").update({ venta_id: ventaId })
      .eq("empresa_id", params.empresaId).eq("id", ses.id).is("venta_id", null).select("id");
    if (setVenta.error) throw new Error(setVenta.error.message);
    if (ses.mesa_id) {
      await sb.from("mesas").update({ estado: "libre" }).eq("empresa_id", params.empresaId).eq("id", ses.mesa_id);
    }

    // Transferencia/tarjeta → registro de conciliación PENDIENTE (no afecta efectivo).
    if (params.metodoPago === "tarjeta" || params.metodoPago === "transferencia") {
      const p = params.pago ?? {};
      const cins = await sb.from("conciliacion_pagos").insert({
        empresa_id: params.empresaId,
        venta_id: ventaId,
        caja_id: caja.id,
        mesa_sesion_id: ses.id,
        cuenta_bancaria_id: p.cuenta_bancaria_id || null,
        medio_pago: params.metodoPago,
        monto: tot,
        referencia: p.referencia || null,
        entidad: p.entidad || null,
        tipo_tarjeta: p.tipo_tarjeta || null,
        fecha_pago: p.fecha_pago || null,
        estado: "pendiente",
        observacion: p.observacion || null,
        registrado_por: params.usuarioId,
      });
      if (cins.error) throw new Error(cins.error.message);
    }

    return { ventaId, numeroControl, yaFacturada: false };
  } catch (err) {
    await revert().catch(() => {});
    throw err;
  }
}

// ── Edición desde CAJA de una sesión por_cobrar (antes de facturar) ────────────

async function sesionEditable(sb: Sb, empresaId: string, sesionId: string): Promise<{ id: string }> {
  const sQ = await sb.from("mesa_sesiones").select("id, estado, venta_id")
    .eq("empresa_id", empresaId).eq("id", sesionId).maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  if (!sQ.data) throw new Error("Sesión no encontrada.");
  const s = sQ.data as { id: string; estado: string; venta_id: string | null };
  if (s.venta_id) throw new Error("La mesa ya fue facturada; no se puede editar.");
  if (s.estado !== "por_cobrar" && s.estado !== "abierta") throw new Error("La cuenta no está editable.");
  return { id: s.id };
}

/** Detalle de una sesión (por_cobrar) para que caja la revise/edite. */
export async function getSesionDetallePg(schema: string, empresaId: string, sesionId: string): Promise<MesaDetalle | null> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const sQ = await sb.from("mesa_sesiones").select(SESION_COLS).eq("empresa_id", empresaId).eq("id", sesionId).maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  if (!sQ.data) return null;
  const sesion = mapSesion(sQ.data as Record<string, unknown>);
  const mQ = sesion.mesa_id
    ? await sb.from("mesas").select(MESA_COLS).eq("empresa_id", empresaId).eq("id", sesion.mesa_id).maybeSingle()
    : { data: null };
  const mesa: Mesa = mQ.data
    ? mapMesa(mQ.data as Record<string, unknown>)
    : { id: sesion.mesa_id ?? "", numero: 0, nombre: null, estado: "por_cobrar", activo: true };
  const iQ = await sb.from("mesa_sesion_items").select(ITEM_COLS)
    .eq("empresa_id", empresaId).eq("sesion_id", sesionId).in("estado", ITEM_VIGENTES).order("created_at", { ascending: true });
  if (iQ.error) throw new Error(iQ.error.message);
  const items = (iQ.data ?? []).map((r) => mapItem(r as Record<string, unknown>));
  return { mesa, sesion, items, total: items.reduce((s, it) => s + it.total, 0) };
}

/** Caja agrega un producto a una sesión por_cobrar (forma parte de la venta final). */
export async function agregarItemCajaPg(params: {
  schema: string; empresaId: string; sesionId: string; productoId: string;
  cantidad: number; observacion: string | null; cajeroId: string | null;
  /** Precio unitario editado en caja (IVA incluido). Si no viene, usa el precio del producto. */
  precioUnitario?: number | null;
  /** Nombre a mostrar (ej. "Pizza mitad y mitad"). */
  displayName?: string | null;
  mitad?: MitadMitadInput | null;
}): Promise<MesaSesionItem> {
  const sb = createServiceRoleClientWithDbSchema(params.schema);
  await sesionEditable(sb, params.empresaId, params.sesionId);

  const pQ = await sb.from("productos").select("nombre, sku, precio_venta")
    .eq("empresa_id", params.empresaId).eq("id", params.productoId).maybeSingle();
  if (pQ.error) throw new Error(pQ.error.message);
  if (!pQ.data) throw new Error("Producto no encontrado en esta empresa.");
  const prod = pQ.data as { nombre: string; sku: string | null; precio_venta: number | string };
  const cantidad = num(params.cantidad);
  if (cantidad <= 0) throw new Error("La cantidad debe ser mayor a 0.");
  // Precio: el editado por caja (si es válido > 0) o el del catálogo. facturarSesionPg
  // lee precio_unitario del ítem, así que el override se respeta en la venta final.
  const precioOverride = params.precioUnitario != null ? num(params.precioUnitario) : 0;
  const precio = precioOverride > 0 ? precioOverride : num(prod.precio_venta);

  const ins = await sb.from("mesa_sesion_items").insert({
    empresa_id: params.empresaId, sesion_id: params.sesionId, producto_id: params.productoId,
    producto_nombre: params.displayName || prod.nombre, sku: prod.sku, cantidad, precio_unitario: precio,
    total: Math.round(precio * cantidad), observacion: params.observacion,
    estado: "pendiente", creado_por: params.cajeroId,
    ...mitadInsertCols(params.displayName ?? null, params.mitad),
  }).select(ITEM_COLS).single();
  if (ins.error) throw new Error(ins.error.message);
  return mapItem(ins.data as Record<string, unknown>);
}

/** Caja ajusta cantidad o cancela un ítem de una sesión por_cobrar. */
export async function actualizarItemCajaPg(params: {
  schema: string; empresaId: string; itemId: string; cantidad?: number; cancelar?: boolean;
}): Promise<MesaSesionItem> {
  const sb = createServiceRoleClientWithDbSchema(params.schema);
  const cur = await sb.from("mesa_sesion_items").select("id, precio_unitario, sesion_id, estado")
    .eq("empresa_id", params.empresaId).eq("id", params.itemId).maybeSingle();
  if (cur.error) throw new Error(cur.error.message);
  if (!cur.data) throw new Error("Ítem no encontrado.");
  const row = cur.data as { precio_unitario: number | string; sesion_id: string; estado: string };
  await sesionEditable(sb, params.empresaId, row.sesion_id);
  if (row.estado === "cancelado") throw new Error("El ítem ya fue cancelado.");

  const patch: Record<string, unknown> = {};
  if (params.cancelar) patch.estado = "cancelado";
  else if (params.cantidad != null) {
    const c = num(params.cantidad);
    if (c <= 0) throw new Error("La cantidad debe ser mayor a 0.");
    patch.cantidad = c;
    patch.total = Math.round(num(row.precio_unitario) * c);
  }
  if (Object.keys(patch).length === 0) throw new Error("Nada para actualizar.");

  const upd = await sb.from("mesa_sesion_items").update(patch)
    .eq("empresa_id", params.empresaId).eq("id", params.itemId).select(ITEM_COLS).single();
  if (upd.error) throw new Error(upd.error.message);
  return mapItem(upd.data as Record<string, unknown>);
}

// ── Helpers sesion-based para PARA LLEVAR ─────────────────────────────────────

/** Agrega un producto a una sesión PL (misma lógica que mesa, sin resolver mesa). */
export async function agregarItemSesionPg(params: {
  schema: string;
  empresaId: string;
  sesionId: string;
  productoId: string;
  cantidad: number;
  observacion: string | null;
  creadoPor: string | null;
  precioUnitario?: number | null;
  displayName?: string | null;
  mitad?: MitadMitadInput | null;
}): Promise<MesaSesionItem> {
  const sb = createServiceRoleClientWithDbSchema(params.schema);

  const sQ = await sb
    .from("mesa_sesiones").select("id, estado, venta_id")
    .eq("empresa_id", params.empresaId).eq("id", params.sesionId).maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  if (!sQ.data) throw new Error("Sesión no encontrada.");
  const s = sQ.data as { id: string; estado: string; venta_id: string | null };
  if (s.venta_id) throw new Error("La cuenta ya fue facturada; no se pueden agregar más productos.");
  if (s.estado !== "abierta") throw new Error("La cuenta ya fue enviada a caja; no se pueden agregar más productos.");

  const pQ = await sb
    .from("productos").select("id, nombre, sku, precio_venta")
    .eq("empresa_id", params.empresaId).eq("id", params.productoId).maybeSingle();
  if (pQ.error) throw new Error(pQ.error.message);
  if (!pQ.data) throw new Error("Producto no encontrado en esta empresa.");
  const prod = pQ.data as { nombre: string; sku: string | null; precio_venta: number | string };

  const cantidad = num(params.cantidad);
  if (cantidad <= 0) throw new Error("La cantidad debe ser mayor a 0.");
  const precioOverride = params.precioUnitario != null ? num(params.precioUnitario) : 0;
  const precio = precioOverride > 0 ? precioOverride : num(prod.precio_venta);
  const total = Math.round(precio * cantidad);

  const ins = await sb.from("mesa_sesion_items").insert({
    empresa_id: params.empresaId,
    sesion_id: params.sesionId,
    producto_id: params.productoId,
    producto_nombre: params.displayName || prod.nombre,
    sku: prod.sku,
    cantidad, precio_unitario: precio, total,
    observacion: params.observacion,
    estado: "pendiente",
    creado_por: params.creadoPor,
    ...mitadInsertCols(params.displayName ?? null, params.mitad),
  }).select(ITEM_COLS).single();
  if (ins.error) throw new Error(ins.error.message);
  return mapItem(ins.data as Record<string, unknown>);
}

/** Envía a cocina los ítems pendientes de una sesión PL. */
export async function enviarComandaSesionPg(
  schema: string,
  empresaId: string,
  sesionId: string,
  usuarioId: string | null
): Promise<ComandaEnvioResult> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const sQ = await sb
    .from("mesa_sesiones").select("id, estado")
    .eq("empresa_id", empresaId).eq("id", sesionId).eq("estado", "abierta").maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  if (!sQ.data) throw new Error("La cuenta no está abierta.");

  const result = await enviarProduccionDeSesion(sb, empresaId, sesionId, usuarioId);
  if (result.total_pendientes === 0) throw new Error("No hay productos nuevos para enviar a comanda.");
  return result;
}

/** Cancela una sesión PL (no toca mesa porque no tiene). */
export async function cancelarSesionPLPg(
  schema: string,
  empresaId: string,
  sesionId: string
): Promise<void> {
  const sb = createServiceRoleClientWithDbSchema(schema);
  const sQ = await sb
    .from("mesa_sesiones").select("id, venta_id, tipo")
    .eq("empresa_id", empresaId).eq("id", sesionId).in("estado", ["abierta", "por_cobrar"]).maybeSingle();
  if (sQ.error) throw new Error(sQ.error.message);
  if (!sQ.data) throw new Error("La cuenta no existe o ya fue cerrada.");
  const s = sQ.data as { id: string; venta_id: string | null; tipo: string };
  if (s.venta_id) throw new Error("La cuenta ya fue facturada; no se puede cancelar.");
  if (s.tipo !== "para_llevar") throw new Error("Esta operación es solo para pedidos Para llevar.");

  const upd = await sb
    .from("mesa_sesiones")
    .update({ estado: "cancelada", cerrada_at: new Date().toISOString() })
    .eq("empresa_id", empresaId).eq("id", sesionId).is("venta_id", null);
  if (upd.error) throw new Error(upd.error.message);
}
