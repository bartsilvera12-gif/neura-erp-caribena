"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { confirmar } from "@/components/ui/ConfirmDialog";
import { cancelarMesa, getMesasPorCobrar } from "@/lib/mesas/storage";
import type { MesaConResumen } from "@/lib/mesas/types";

function formatGs(v: number) { return `Gs. ${Math.round(v).toLocaleString("es-PY")}`; }

export default function MesasPorCobrarPage() {
  const [mesas, setMesas] = useState<MesaConResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await getMesasPorCobrar();
    setMesas(d);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * Saca una mesa del tablero sin cobrarla.
   *
   * Hacía falta porque una mesa abierta por error —o una que se levantó sin
   * consumir— se quedaba acá para siempre, y encima cuenta como pendiente en el
   * arqueo del turno. No borra nada: la cuenta queda marcada como cancelada, así
   * que el rastro de que existió no se pierde.
   *
   * El aviso cambia según lo que se esté descartando. No es lo mismo cerrar una
   * mesa vacía que una con Gs. 45.000 cargados: en el segundo caso el texto dice
   * cuánto se está tirando, porque una vez hecho no se puede reabrir.
   */
  async function onCancelar(m: MesaConResumen) {
    const conItems =
      m.items_count > 0
        ? ` Se descartan sus ${m.items_count} producto(s) por ${formatGs(m.total)}, que no se van a cobrar.`
        : " No tiene productos cargados.";
    const enCocina =
      m.items_count > 0
        ? " Si ya se envió comanda, lo que esté en cocina no se cancela solo: avisá al sector."
        : "";

    const ok = await confirmar(
      `¿Cancelar la cuenta de la Mesa ${m.mesa.numero}?${conItems}${enCocina} La mesa queda libre y sale de esta lista; no se puede reabrir.`,
      { confirmLabel: "Cancelar cuenta", cancelLabel: "Volver" }
    );
    if (!ok) return;

    setError(null);
    setBusy(m.mesa.id);
    const r = await cancelarMesa(m.mesa.id);
    setBusy(null);
    if (!r.success) { setError(r.error); return; }
    // Sale de la lista en el momento, sin esperar la recarga.
    setMesas((prev) => prev.filter((x) => x.mesa.id !== m.mesa.id));
    void load();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/ventas" className="text-xs text-[#0EA5E9] hover:underline">← Caja</Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Mesas por cobrar</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Tocá una mesa para facturarla con la misma pantalla de Nueva venta: buscador de productos, edición de la cuenta y cobro.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-slate-400">Cargando…</p>
      ) : mesas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-slate-400">No hay mesas por cobrar.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {mesas.map((m) => m.sesion && (
            <div
              key={m.sesion.id}
              className="rounded-xl border border-rose-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-2xl font-extrabold text-slate-800">Mesa {m.mesa.numero}</p>
                  <p className="text-xs text-slate-500">Mozo: {m.mozo_nombre ?? "—"} · {m.items_count} ítem(s)</p>
                </div>
                <div className="flex items-start gap-2">
                  <p className="text-2xl font-extrabold tabular-nums text-slate-900">{formatGs(m.total)}</p>
                  {/* Cancelar queda apartado del botón de cobrar y sin color de
                      alarma: es una salida disponible, no la acción esperada. */}
                  <button
                    type="button"
                    onClick={() => void onCancelar(m)}
                    disabled={busy === m.mesa.id}
                    title={`Cancelar la cuenta de la Mesa ${m.mesa.numero}`}
                    aria-label={`Cancelar la cuenta de la Mesa ${m.mesa.numero}`}
                    className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600 active:scale-95 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Link
                  href={`/ventas/mesas-por-cobrar/${m.sesion.id}`}
                  className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  Facturar mesa →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
