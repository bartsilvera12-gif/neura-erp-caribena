"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MesaProductPicker from "@/components/mesas/MesaProductPicker";
import MitadMitadPicker, { type MitadMitadResult } from "@/components/ventas/MitadMitadPicker";
import {
  actualizarItemMesa, agregarItemMesa, cancelarCuentaMesa,
  enviarComandaMesa, enviarMesaACaja, getMesaDetalle,
} from "@/lib/mesas/storage";
import type { EstadoMesa, MesaSesionItem } from "@/lib/mesas/types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

const ESTADO_BADGE: Record<EstadoMesa, string> = {
  libre: "bg-emerald-100 text-emerald-700",
  ocupada: "bg-amber-100 text-amber-700",
  por_cobrar: "bg-rose-100 text-rose-700",
  cerrada: "bg-slate-100 text-slate-600",
  inactiva: "bg-slate-100 text-slate-600",
};

export default function MesaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [numero, setNumero] = useState<number | null>(null);
  const [mesaEstado, setMesaEstado] = useState<EstadoMesa>("libre");
  const [porCobrar, setPorCobrar] = useState(false);
  const [items, setItems] = useState<MesaSesionItem[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mitadOpen, setMitadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const tmpCounter = useRef(0);

  const load = useCallback(async () => {
    const d = await getMesaDetalle(id);
    if (d) {
      setNumero(d.mesa.numero);
      setMesaEstado(d.mesa.estado);
      setPorCobrar(d.sesion?.estado === "por_cobrar");
      setItems(d.items);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const markPending = (tmpId: string, on: boolean) =>
    setPendingIds((prev) => { const n = new Set(prev); if (on) n.add(tmpId); else n.delete(tmpId); return n; });

  // ── Agregar (optimista): aparece al instante, la API guarda en segundo plano ──
  async function onAdd(
    prod: { id: string; nombre: string; precio_venta: number },
    cantidad: number,
    observacion: string | null
  ): Promise<boolean> {
    setError(null);
    const tmpId = `tmp-${++tmpCounter.current}`;
    const optimistic: MesaSesionItem = {
      id: tmpId, sesion_id: "", producto_id: prod.id, producto_nombre: prod.nombre, sku: null,
      cantidad, precio_unitario: prod.precio_venta, total: Math.round(prod.precio_venta * cantidad),
      observacion, estado: "pendiente", comanda_id: null, enviado_at: null,
    };
    setItems((prev) => [...prev, optimistic]);
    markPending(tmpId, true);
    setMesaEstado((e) => (e === "libre" ? "ocupada" : e));

    const r = await agregarItemMesa(id, { producto_id: prod.id, cantidad, observacion });
    if (!r.success) {
      setItems((prev) => prev.filter((i) => i.id !== tmpId)); // revertir
      markPending(tmpId, false);
      setError(r.error);
      return false;
    }
    setItems((prev) => prev.map((i) => (i.id === tmpId ? r.item : i))); // reconciliar
    markPending(tmpId, false);
    return true;
  }

  // Pizza mitad y mitad (optimista): aparece al instante con el precio del sabor más caro.
  async function onAddMitad(r: MitadMitadResult) {
    setMitadOpen(false);
    setError(null);
    const tmpId = `tmp-${++tmpCounter.current}`;
    const optimistic: MesaSesionItem = {
      id: tmpId, sesion_id: "", producto_id: r.producto_id, producto_nombre: r.display_name, sku: null,
      cantidad: 1, precio_unitario: r.precio_unitario, total: r.precio_unitario,
      observacion: null, estado: "pendiente", comanda_id: null, enviado_at: null,
      es_mitad_mitad: true, mitad_1_nombre: r.mitad.nombre1, mitad_2_nombre: r.mitad.nombre2,
    };
    setItems((prev) => [...prev, optimistic]);
    markPending(tmpId, true);
    setMesaEstado((e) => (e === "libre" ? "ocupada" : e));

    const res = await agregarItemMesa(id, {
      producto_id: r.producto_id, cantidad: 1, observacion: null,
      precio_unitario: r.precio_unitario, display_name: r.display_name, mitad: r.mitad,
    });
    if (!res.success) {
      setItems((prev) => prev.filter((i) => i.id !== tmpId));
      markPending(tmpId, false);
      setError(res.error);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === tmpId ? res.item : i)));
    markPending(tmpId, false);
  }

  async function onChangeQty(item: MesaSesionItem, delta: number) {
    if (item.id.startsWith("tmp-") || item.estado !== "pendiente") return;
    const nueva = Math.max(1, item.cantidad + delta);
    if (nueva === item.cantidad) return;
    const prev = items;
    setItems((p) => p.map((i) => (i.id === item.id ? { ...i, cantidad: nueva, total: Math.round(i.precio_unitario * nueva) } : i)));
    const r = await actualizarItemMesa(item.id, { cantidad: nueva });
    if (!r.success) { setItems(prev); setError(r.error); }
  }

  async function onCancelItem(item: MesaSesionItem) {
    if (item.id.startsWith("tmp-")) return;
    if (item.estado === "enviado" && !confirm("Este producto ya fue enviado a cocina. ¿Cancelarlo igual?")) return;
    const prev = items;
    setItems((p) => p.filter((i) => i.id !== item.id));
    const r = await actualizarItemMesa(item.id, { cancelar: true });
    if (!r.success) { setItems(prev); setError(r.error); }
  }

  async function onEnviarComanda() {
    setError(null); setOkMsg(null); setBusy(true);
    const r = await enviarComandaMesa(id);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setItems((prev) => prev.map((i) => (i.estado === "pendiente" ? { ...i, estado: "enviado" } : i)));
    if (r.sin_produccion || r.comandas.length === 0) {
      setOkMsg("No hay productos que requieran producción.");
    } else {
      const partes = r.comandas.map((c) => `${c.sector === "pizzeria" ? "Pizzería" : "Plancha"} N°${c.numero}`);
      setOkMsg(`Enviado a producción: ${partes.join(" · ")}.`);
    }
    setTimeout(() => setOkMsg(null), 3000);
  }

  async function onPedirCuenta() {
    setError(null);
    const hayPendientes = items.some((i) => i.estado === "pendiente");
    if (hayPendientes) {
      const enviar = confirm("Hay productos sin enviar a comanda. ¿Querés enviarlos a cocina antes de pedir la cuenta?");
      if (enviar) {
        const c = await enviarComandaMesa(id);
        if (!c.success) { setError(c.error); return; }
      }
    }
    setBusy(true);
    const r = await enviarMesaACaja(id);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    router.push("/mesas");
  }

  async function onCancelarCuenta() {
    if (!confirm(`¿Cancelar la cuenta de la mesa ${numero}? Esto no factura ni cobra nada.`)) return;
    setBusy(true);
    const r = await cancelarCuentaMesa(id);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    router.push("/mesas");
  }

  if (loading) return <p className="py-10 text-center text-slate-400">Cargando mesa…</p>;

  const total = items.reduce((s, i) => s + i.total, 0);
  const hayItems = items.length > 0;
  const hayPendientes = items.some((i) => i.estado === "pendiente");

  return (
    <div className="space-y-5 pb-32">
      <div>
        <button onClick={() => router.push("/mesas")} className="text-sm text-[#0EA5E9]">← Mesas</button>
        <h1 className="text-2xl font-bold text-slate-800">
          Mesa {numero}
          <span className={`ml-2 align-middle rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_BADGE[mesaEstado]}`}>
            {mesaEstado === "por_cobrar" ? "Por cobrar" : mesaEstado.charAt(0).toUpperCase() + mesaEstado.slice(1)}
          </span>
        </h1>
      </div>

      {porCobrar && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
          Esta cuenta fue enviada a caja. La cobra/factura el cajero.
        </div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">⚠ {error}</div>}
      {okMsg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{okMsg}</div>}

      {/* Lista de productos */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Pedido</h2>
        {!hayItems ? (
          <p className="py-8 text-center text-slate-400">Todavía no agregaste productos.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((it) => {
              const tmp = it.id.startsWith("tmp-") || pendingIds.has(it.id);
              const enviado = it.estado === "enviado";
              return (
                <li key={it.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{it.cantidad}× {it.producto_nombre}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${enviado ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                        {enviado ? "Enviado" : "Pendiente"}
                      </span>
                      {tmp && <span className="text-[10px] text-slate-400">guardando…</span>}
                    </div>
                    {it.es_mitad_mitad && it.mitad_1_nombre && it.mitad_2_nombre && (
                      <p className="text-xs text-amber-700">½ {it.mitad_1_nombre} + ½ {it.mitad_2_nombre}</p>
                    )}
                    {it.observacion && <p className="text-xs text-amber-700">— {it.observacion}</p>}
                    <p className="text-xs text-slate-400">{formatGs(it.precio_unitario)} c/u</p>
                    {/* Editar cantidad solo si es pendiente (no enviado a cocina). */}
                    {!porCobrar && !enviado && !tmp && (
                      <div className="mt-1 flex items-center gap-2">
                        <button type="button" onClick={() => onChangeQty(it, -1)} className="h-8 w-8 rounded-md border border-slate-300 text-lg font-bold leading-none">−</button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">{it.cantidad}</span>
                        <button type="button" onClick={() => onChangeQty(it, +1)} className="h-8 w-8 rounded-md border border-slate-300 text-lg font-bold leading-none">+</button>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-semibold tabular-nums text-slate-800">{formatGs(it.total)}</span>
                    {!porCobrar && !tmp && (
                      <button type="button" onClick={() => onCancelItem(it)} className="text-xs text-red-400 hover:text-red-600">
                        ✕ {enviado ? "Quitar" : "Cancelar"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
          <span className="text-base font-bold text-slate-900">TOTAL</span>
          <span className="text-xl font-extrabold tabular-nums text-slate-900">{formatGs(total)}</span>
        </div>
      </div>

      {/* Acciones (sticky abajo) — solo si la cuenta sigue en mano del mozo */}
      {!porCobrar && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
          <div className="mx-auto grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setPickerOpen(true)}
              className="rounded-xl bg-[#0EA5E9] px-5 py-4 text-base font-semibold text-white shadow-sm hover:bg-[#0284C7] active:scale-95">
              + Agregar productos
            </button>
            <button type="button" onClick={() => setMitadOpen(true)}
              className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-base font-semibold text-amber-800 shadow-sm hover:bg-amber-100 active:scale-95">
              🍕 Pizza mitad y mitad
            </button>
            {hayPendientes && (
              <button type="button" onClick={onEnviarComanda} disabled={busy}
                className="rounded-xl bg-indigo-600 px-5 py-4 text-base font-semibold text-white shadow-sm hover:bg-indigo-700 active:scale-95 disabled:opacity-50">
                Enviar comanda
              </button>
            )}
            {hayItems && (
              <button type="button" onClick={onPedirCuenta} disabled={busy}
                className="rounded-xl bg-emerald-600 px-5 py-4 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 active:scale-95 disabled:opacity-50">
                Pedir cuenta
              </button>
            )}
            {hayItems && (
              <button type="button" onClick={onCancelarCuenta} disabled={busy}
                className="rounded-xl border border-rose-300 px-5 py-4 text-base font-semibold text-rose-600 hover:bg-rose-50 active:scale-95 disabled:opacity-50">
                Cancelar cuenta
              </button>
            )}
          </div>
        </div>
      )}

      <MesaProductPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onAdd={onAdd} />
      <MitadMitadPicker open={mitadOpen} onClose={() => setMitadOpen(false)} onConfirm={onAddMitad} />
    </div>
  );
}
