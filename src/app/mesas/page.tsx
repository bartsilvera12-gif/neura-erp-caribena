"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMesas } from "@/lib/mesas/storage";
import type { EstadoMesa, MesaConResumen } from "@/lib/mesas/types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

interface MesaStyle {
  card: string;
  tile: string;
  pill: string;
  dot: string;
  label: string;
}

const ESTADO_STYLE: Record<EstadoMesa, MesaStyle> = {
  libre:      { card: "border-slate-200 bg-white hover:border-emerald-300",            tile: "bg-emerald-50 text-emerald-600", pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "Libre" },
  ocupada:    { card: "border-amber-200 bg-amber-50/40 hover:border-amber-300",        tile: "bg-amber-100 text-amber-700",    pill: "bg-amber-100 text-amber-800",    dot: "bg-amber-500",   label: "Ocupada" },
  por_cobrar: { card: "border-rose-200 bg-rose-50/50 hover:border-rose-300 ring-1 ring-rose-100", tile: "bg-rose-100 text-rose-700", pill: "bg-rose-100 text-rose-800",   dot: "bg-rose-500",    label: "Por cobrar" },
  cerrada:    { card: "border-slate-200 bg-slate-50 hover:border-slate-300",           tile: "bg-slate-100 text-slate-500",    pill: "bg-slate-100 text-slate-600",    dot: "bg-slate-400",   label: "Cerrada" },
  inactiva:   { card: "border-slate-200 bg-slate-50 opacity-60",                       tile: "bg-slate-100 text-slate-400",    pill: "bg-slate-100 text-slate-500",    dot: "bg-slate-300",   label: "Inactiva" },
};

export default function MesasPage() {
  const router = useRouter();
  const [mesas, setMesas] = useState<MesaConResumen[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => getMesas().then((d) => { if (!cancelled) { setMesas(d); setLoading(false); } });
    load();
    const t = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Mesas</h1>
        <p className="text-sm text-slate-500">Tocá una mesa para tomar el pedido.</p>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(["libre", "ocupada", "por_cobrar"] as EstadoMesa[]).map((e) => (
          <span key={e} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${ESTADO_STYLE[e].pill}`}>
            <span className={`inline-block h-2 w-2 rounded-full ${ESTADO_STYLE[e].dot}`} />
            {ESTADO_STYLE[e].label}
          </span>
        ))}
      </div>

      {loading ? (
        <p className="py-10 text-center text-slate-400">Cargando mesas…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {mesas.map((m) => {
            const st = ESTADO_STYLE[m.mesa.estado];
            const activa = !!m.sesion;
            return (
              <button
                key={m.mesa.id}
                type="button"
                onClick={() => router.push(`/mesas/${m.mesa.id}`)}
                className={`group flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-3xl border p-5 text-center shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md active:scale-[0.98] ${st.card}`}
              >
                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-extrabold transition-transform duration-200 group-hover:scale-105 ${st.tile}`}>
                  {m.mesa.numero}
                </div>
                <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-slate-400">Mesa</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.pill}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                  {st.label}
                </span>
                {activa ? (
                  <div className="mt-0.5 flex flex-col items-center leading-tight">
                    <span className="text-sm font-bold tabular-nums text-slate-800">{formatGs(m.total)}</span>
                    {m.items_count > 0 && <span className="text-[11px] text-slate-400">{m.items_count} ítem(s)</span>}
                  </div>
                ) : (
                  <span className="mt-0.5 text-[11px] text-slate-300">Tocá para abrir</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
