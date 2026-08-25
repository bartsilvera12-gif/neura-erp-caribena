"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, X } from "lucide-react";
import { crearMesas, getMesasConUltimoNumero } from "@/lib/mesas/storage";
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
  const [ultimoNumero, setUltimoNumero] = useState(0);
  const [loading, setLoading] = useState(true);

  // Alta de mesas
  const [modalAbierto, setModalAbierto] = useState(false);
  const [desde, setDesde] = useState("1");
  const [cantidad, setCantidad] = useState("1");
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const [avisoAlta, setAvisoAlta] = useState<string | null>(null);

  const recargar = () =>
    getMesasConUltimoNumero().then((d) => {
      setMesas(d.mesas);
      setUltimoNumero(d.ultimoNumero);
      setLoading(false);
      return d;
    });

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getMesasConUltimoNumero().then((d) => {
        if (!cancelled) { setMesas(d.mesas); setUltimoNumero(d.ultimoNumero); setLoading(false); }
      });
    load();
    // Mientras el modal está abierto no refrescamos: pisaría lo que el usuario
    // está tipeando en "desde".
    const t = setInterval(() => { if (!modalAbierto) load(); }, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [modalAbierto]);

  function abrirModal() {
    setDesde(String(ultimoNumero + 1));
    setCantidad("1");
    setNombre("");
    setErrorAlta(null);
    setAvisoAlta(null);
    setModalAbierto(true);
  }

  const desdeNum = parseInt(desde, 10);
  const cantNum = parseInt(cantidad, 10);
  const rangoValido = Number.isInteger(desdeNum) && desdeNum >= 1 && Number.isInteger(cantNum) && cantNum >= 1;
  const hasta = rangoValido ? desdeNum + cantNum - 1 : null;

  async function confirmarAlta() {
    if (!rangoValido || guardando) return;
    setGuardando(true);
    setErrorAlta(null);
    setAvisoAlta(null);
    const res = await crearMesas(desdeNum, cantNum, cantNum === 1 ? nombre : null);
    setGuardando(false);
    if (!res.ok) { setErrorAlta(res.error); return; }

    await recargar();
    if (res.creadas.length === 0) {
      setErrorAlta(`Esas mesas ya existían (${res.existentes.join(", ")}). No se creó ninguna.`);
      return;
    }
    if (res.existentes.length > 0) {
      setAvisoAlta(
        `Se crearon ${res.creadas.length} mesa(s). Ya existían y se saltearon: ${res.existentes.join(", ")}.`
      );
      return;
    }
    setModalAbierto(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Mesas</h1>
          <p className="text-sm text-slate-500">Tocá una mesa para tomar el pedido.</p>
        </div>
        <button
          type="button"
          onClick={abrirModal}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Crear mesas
        </button>
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
      ) : mesas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <p className="text-base font-semibold text-slate-700">Todavía no hay mesas cargadas</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Creá las mesas del salón para empezar a tomar pedidos. Podés numerarlas de corrido y
            renombrarlas después.
          </p>
          <button
            type="button"
            onClick={abrirModal}
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Crear mesas
          </button>
        </div>
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

      {modalAbierto && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/60 px-3 pt-16 backdrop-blur-sm"
          onClick={() => !guardando && setModalAbierto(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-800">Crear mesas</h2>
              <button
                type="button"
                onClick={() => setModalAbierto(false)}
                disabled={guardando}
                className="text-slate-400 transition-colors hover:text-slate-700 disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Desde el número
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={desde}
                    onChange={(e) => setDesde(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Cantidad
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                  />
                </div>
              </div>

              {cantNum === 1 && (
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Nombre <span className="font-normal normal-case text-slate-400">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej: Terraza 1, Barra"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                  />
                </div>
              )}

              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {rangoValido
                  ? cantNum === 1
                    ? `Se creará la mesa ${desdeNum}.`
                    : `Se crearán ${cantNum} mesas, de la ${desdeNum} a la ${hasta}.`
                  : "Ingresá un número inicial y una cantidad válidos."}
                {ultimoNumero > 0 && ` La mesa más alta hoy es la ${ultimoNumero}.`}
              </p>

              {errorAlta && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{errorAlta}</span>
                </div>
              )}
              {avisoAlta && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{avisoAlta}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setModalAbierto(false)}
                disabled={guardando}
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarAlta}
                disabled={!rangoValido || guardando}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden />
                {guardando ? "Creando…" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
