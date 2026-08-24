"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMesasPorCobrar } from "@/lib/mesas/storage";
import type { MesaConResumen } from "@/lib/mesas/types";

function formatGs(v: number) { return `Gs. ${Math.round(v).toLocaleString("es-PY")}`; }

export default function MesasPorCobrarPage() {
  const [mesas, setMesas] = useState<MesaConResumen[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { getMesasPorCobrar().then((d) => { setMesas(d); setLoading(false); }); }, []);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/ventas" className="text-xs text-[#0EA5E9] hover:underline">← Caja</Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Mesas por cobrar</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Tocá una mesa para facturarla con la misma pantalla de Nueva venta: buscador de productos, edición de la cuenta y cobro.
        </p>
      </div>

      {loading ? (
        <p className="py-10 text-center text-slate-400">Cargando…</p>
      ) : mesas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-slate-400">No hay mesas por cobrar.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {mesas.map((m) => m.sesion && (
            <Link
              key={m.sesion.id}
              href={`/ventas/mesas-por-cobrar/${m.sesion.id}`}
              className="block rounded-xl border border-rose-200 bg-white p-4 shadow-sm transition-colors hover:bg-rose-50/40"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-2xl font-extrabold text-slate-800">Mesa {m.mesa.numero}</p>
                  <p className="text-xs text-slate-500">Mozo: {m.mozo_nombre ?? "—"} · {m.items_count} ítem(s)</p>
                </div>
                <p className="text-2xl font-extrabold tabular-nums text-slate-900">{formatGs(m.total)}</p>
              </div>
              <div className="mt-3 flex justify-end">
                <span className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white">Facturar mesa →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
