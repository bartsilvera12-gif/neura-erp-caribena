"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { comandaPrintUrl, imprimirComanda } from "@/lib/comandas/storage";
import { crearParaLlevar, getParaLlevarActivas } from "@/lib/mesas/storage";
import type { ComandaCard } from "@/lib/comandas/types";
import type { ParaLlevarConResumen } from "@/lib/mesas/types";
import { SectorBadge } from "@/components/comandas/SectorBadge";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatPL(n: number | null | undefined): string {
  return `PL-${String(n ?? 0).padStart(3, "0")}`;
}
function formatHora(iso: string | null) {
  if (!iso) return "—";
  try {
    // Paraguay UTC-3 fija (tzdata del contenedor puede estar stale).
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const s = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(s.getUTCDate())}/${p(s.getUTCMonth() + 1)} ${p(s.getUTCHours())}:${p(s.getUTCMinutes())}`;
  } catch { return iso; }
}

async function fetchPedidosPL(estado?: string): Promise<ComandaCard[]> {
  try {
    const qs = estado ? `?estado=${encodeURIComponent(estado)}` : "";
    const res = await fetchWithSupabaseSession(`/api/pedidos-para-llevar${qs}`, { cache: "no-store" });
    const json = (await res.json()) as { success?: boolean; data?: { comandas: ComandaCard[] }; error?: string };
    if (!res.ok || !json.success) return [];
    return json.data?.comandas ?? [];
  } catch { return []; }
}

export default function PedidosParaLlevarPage() {
  const router = useRouter();
  const [pendientes, setPendientes] = useState<ComandaCard[]>([]);
  const [activos, setActivos] = useState<ParaLlevarConResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [pend, act] = await Promise.all([fetchPedidosPL("generada"), getParaLlevarActivas()]);
    setPendientes(pend);
    setActivos(act);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => { if (!cancelled) void load(); };
    run();
    const t = setInterval(run, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [load]);

  async function onCrear() {
    setModalError(null);
    setCreating(true);
    const n = nombre.trim() || null;
    const r = await crearParaLlevar(n);
    setCreating(false);
    if (!r.success) { setModalError(r.error); return; }
    setModalOpen(false);
    setNombre("");
    router.push(`/mesas/pl/${r.sesion.id}`);
  }

  async function onImprimir(c: ComandaCard) {
    setError(null); setBusy(c.id);
    const w = window.open("about:blank", "_blank");
    const r = await imprimirComanda(c.id);
    setBusy(null);
    if (!r.success) { try { w?.close(); } catch { /* ignore */ } setError(r.error); return; }
    const href = comandaPrintUrl(c.id);
    try { if (w) w.location.href = href; else window.open(href, "_blank", "noopener"); } catch { /* ignore */ }
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Pedidos para llevar</h1>
          <p className="text-sm text-slate-500">Pedidos con retiro en mostrador. Se refresca cada 15s.</p>
        </div>
        <button
          type="button"
          onClick={() => { setNombre(""); setModalError(null); setModalOpen(true); }}
          className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 active:scale-95"
        >
          + Nuevo Para llevar
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">⚠ {error}</div>}

      {loading ? (
        <p className="py-10 text-center text-slate-400">Cargando…</p>
      ) : (
        <>
          {/* Sección: pedidos abiertos por el mozo (todavía sin comanda) */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">En preparación</h2>
              <span className="text-xs text-slate-500">{activos.length} activo(s)</span>
            </div>
            {activos.length === 0 ? (
              <p className="py-3 text-center text-sm text-slate-400">No hay pedidos abiertos.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {activos.map(({ sesion, total, items_count, mozo_nombre }) => (
                  <li key={sesion.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/mesas/pl/${sesion.id}`)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-indigo-300 hover:shadow-md active:scale-[0.98]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800">{formatPL(sesion.numero_pl)}</span>
                          {sesion.estado === "por_cobrar" && (
                            <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Por cobrar</span>
                          )}
                        </div>
                        {sesion.nombre_cliente && <p className="truncate text-xs text-slate-500">{sesion.nombre_cliente}</p>}
                        <p className="text-[11px] text-slate-400">
                          {items_count} ítem(s){mozo_nombre ? ` · ${mozo_nombre}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-slate-800">{formatGs(total)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Sección: comandas pendientes de imprimir (ya enviadas a cocina) */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Comandas por imprimir</h2>
              <span className="text-xs text-slate-500">{pendientes.length} pendiente(s)</span>
            </div>
            {pendientes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
                <p className="text-slate-400">No hay comandas pendientes.</p>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pendientes.map((c) => {
                  const items = c.items.filter((i) => !i.cancelado);
                  return (
                    <li key={c.id} className="flex flex-col justify-between rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-800">Para llevar</span>
                              <span className="font-bold tabular-nums text-slate-800">{formatPL(c.numero_pl)}</span>
                            </div>
                            {c.nombre_cliente && <p className="mt-0.5 text-sm text-slate-600">{c.nombre_cliente}</p>}
                            <p className="text-xs text-slate-400">
                              N°{c.numero} · {formatHora(c.created_at)}
                              {c.mozo_nombre ? ` · ${c.mozo_nombre}` : ""}
                            </p>
                          </div>
                          {c.sector && <SectorBadge sector={c.sector} />}
                        </div>

                        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2">
                          {items.map((it) => (
                            <li key={it.id} className="text-sm text-slate-800">
                              <span className="font-semibold">{it.cantidad}×</span> {it.producto_nombre}
                              {it.es_mitad_mitad && it.mitad_1_nombre && it.mitad_2_nombre && (
                                <span className="block pl-5 text-xs text-amber-700">½ {it.mitad_1_nombre} + ½ {it.mitad_2_nombre}</span>
                              )}
                              {it.observacion && <span className="block pl-5 text-xs text-amber-700">— {it.observacion}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <button
                        type="button"
                        onClick={() => onImprimir(c)}
                        disabled={busy === c.id}
                        className="mt-4 w-full rounded-xl bg-indigo-600 px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
                      >
                        {busy === c.id ? "Imprimiendo…" : "Imprimir"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Modal Nuevo Para llevar */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !creating && setModalOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800">Nuevo Para llevar</h3>
            <p className="mt-1 text-sm text-slate-500">Nombre del cliente (opcional). El correlativo PL se asigna automáticamente.</p>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Karen"
              maxLength={120}
              disabled={creating}
              autoFocus
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              onKeyDown={(e) => { if (e.key === "Enter") void onCrear(); }}
            />
            {modalError && <p className="mt-2 text-sm text-red-600">⚠ {modalError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={creating} onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" disabled={creating} onClick={onCrear}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {creating ? "Creando…" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
