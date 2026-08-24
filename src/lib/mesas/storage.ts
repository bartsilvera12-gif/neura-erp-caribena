import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type {
  ComandaEnvioResult, MesaConResumen, MesaDetalle, MesaSesion, MesaSesionItem,
  ParaLlevarConResumen,
} from "./types";

type Ok<T> = { success: true } & T;
type Err = { success: false; error: string };

async function call<T>(url: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<Ok<T> | Err> {
  try {
    const res = await fetchWithSupabaseSession(url, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as { success?: boolean; data?: T; error?: string };
    if (!res.ok || !json.success || !json.data) return { success: false, error: json.error ?? `Error (${res.status}).` };
    return { success: true, ...(json.data as T) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

export async function getMesas(): Promise<MesaConResumen[]> {
  const r = await call<{ mesas: MesaConResumen[] }>("/api/mesas", "GET");
  return r.success ? r.mesas : [];
}

export async function getMesaDetalle(mesaId: string): Promise<MesaDetalle | null> {
  const r = await call<{ detalle: MesaDetalle }>(`/api/mesas/${encodeURIComponent(mesaId)}`, "GET");
  return r.success ? r.detalle : null;
}

export interface MitadItemPayload {
  precio_unitario?: number;
  display_name?: string;
  mitad?: { producto1_id: string; producto2_id: string; nombre1: string; nombre2: string };
}

export function agregarItemMesa(
  mesaId: string,
  payload: { producto_id: string; cantidad: number; observacion: string | null } & MitadItemPayload
) {
  return call<{ item: MesaSesionItem }>(`/api/mesas/${encodeURIComponent(mesaId)}/items`, "POST", payload);
}

export function actualizarItemMesa(itemId: string, payload: { cantidad?: number; observacion?: string | null; cancelar?: boolean }) {
  return call<{ item: MesaSesionItem }>(`/api/mesas/items/${encodeURIComponent(itemId)}`, "PATCH", payload);
}

/** Envía los ítems pendientes a producción (comandas por sector). La mesa sigue ocupada. */
export function enviarComandaMesa(mesaId: string) {
  return call<ComandaEnvioResult>(`/api/mesas/${encodeURIComponent(mesaId)}/comanda`, "POST", {});
}

/** Pedir cuenta / enviar a caja para cobrar (la mesa pasa a por_cobrar). */
export function enviarMesaACaja(mesaId: string) {
  return call<{ sesion: unknown }>(`/api/mesas/${encodeURIComponent(mesaId)}/enviar-caja`, "POST", {});
}

export function cancelarCuentaMesa(mesaId: string) {
  return call<{ ok: boolean }>(`/api/mesas/${encodeURIComponent(mesaId)}/cancelar`, "POST", {});
}

export async function getMesasPorCobrar(): Promise<MesaConResumen[]> {
  const r = await call<{ mesas: MesaConResumen[] }>("/api/mesas/por-cobrar", "GET");
  return r.success ? r.mesas : [];
}

export interface PagoConciliacionInput {
  referencia?: string | null;
  entidad?: string | null;
  tipo_tarjeta?: string | null;
  cuenta_bancaria_id?: string | null;
  fecha_pago?: string | null;
  observacion?: string | null;
}

export function facturarMesa(
  sesionId: string,
  metodoPago: "efectivo" | "tarjeta" | "transferencia",
  pago?: PagoConciliacionInput | null
) {
  return call<{ ventaId: string; numeroControl: string | null; yaFacturada: boolean }>(
    `/api/mesas/sesiones/${encodeURIComponent(sesionId)}/facturar`,
    "POST",
    { metodo_pago: metodoPago, pago: pago ?? null }
  );
}

// ── PARA LLEVAR ───────────────────────────────────────────────────────────────

/** Crea una nueva sesión "Para llevar" (opcional: nombre del cliente). */
export function crearParaLlevar(nombreCliente: string | null) {
  return call<{ sesion: MesaSesion }>("/api/mesas/para-llevar", "POST", { nombre_cliente: nombreCliente });
}

/** Lista sesiones PL activas (abierta/por_cobrar) para el listado en /mesas. */
export async function getParaLlevarActivas(): Promise<ParaLlevarConResumen[]> {
  const r = await call<{ items: ParaLlevarConResumen[] }>("/api/mesas/para-llevar", "GET");
  return r.success ? r.items : [];
}

/** Detalle de una sesión PL. */
export async function getParaLlevarDetalle(sesionId: string): Promise<{ sesion: MesaSesion; items: MesaSesionItem[]; total: number } | null> {
  const r = await call<{ detalle: { sesion: MesaSesion; items: MesaSesionItem[]; total: number } }>(
    `/api/mesas/pl/${encodeURIComponent(sesionId)}`, "GET"
  );
  return r.success ? r.detalle : null;
}

export function agregarItemPL(
  sesionId: string,
  payload: { producto_id: string; cantidad: number; observacion: string | null } & MitadItemPayload
) {
  return call<{ item: MesaSesionItem }>(`/api/mesas/pl/${encodeURIComponent(sesionId)}/items`, "POST", payload);
}

export function enviarComandaPL(sesionId: string) {
  return call<ComandaEnvioResult>(`/api/mesas/pl/${encodeURIComponent(sesionId)}/comanda`, "POST", {});
}

export function cancelarPL(sesionId: string) {
  return call<{ ok: boolean }>(`/api/mesas/pl/${encodeURIComponent(sesionId)}/cancelar`, "POST", {});
}
