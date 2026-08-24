"use client";

import { useEffect, useMemo, useState } from "react";

interface PizzaItem {
  id: string;
  nombre: string;
  sku: string;
  precio_venta: number;
}

/** Resultado normalizado de una pizza mitad y mitad (precio = max de ambos sabores). */
export interface MitadMitadResult {
  producto_id: string;   // sabor más caro (define sector + precio)
  sku: string;
  display_name: string;  // "Pizza mitad y mitad"
  precio_unitario: number;
  mitad: { producto1_id: string; producto2_id: string; nombre1: string; nombre2: string };
}

function formatGs(v: number) { return `Gs. ${Math.round(v).toLocaleString("es-PY")}`; }

/**
 * Modal para armar una pizza MITAD y MITAD: dos sabores de pizzería; el precio
 * final es el del sabor MÁS CARO (max, nunca promedio ni suma).
 */
export default function MitadMitadPicker({
  open, onClose, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (r: MitadMitadResult) => void;
}) {
  const [pizzas, setPizzas] = useState<PizzaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [s1, setS1] = useState("");
  const [s2, setS2] = useState("");

  useEffect(() => {
    if (!open) return;
    setS1(""); setS2(""); setError(null); setLoading(true);
    fetch("/api/productos/search?sector=pizzeria&limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) {
          const items = (j.data?.items ?? []) as PizzaItem[];
          setPizzas(items.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)));
        } else setError(j?.error ?? "No se pudieron cargar las pizzas.");
      })
      .catch(() => setError("Error de red al cargar pizzas."))
      .finally(() => setLoading(false));
  }, [open]);

  const p1 = useMemo(() => pizzas.find((p) => p.id === s1) ?? null, [pizzas, s1]);
  const p2 = useMemo(() => pizzas.find((p) => p.id === s2) ?? null, [pizzas, s2]);
  const precio = Math.max(p1?.precio_venta ?? 0, p2?.precio_venta ?? 0);
  const valido = !!p1 && !!p2;

  function confirmar() {
    if (!p1 || !p2) return;
    // El sabor más caro define producto_id / sku / sector (precio = max).
    const caro = (p1.precio_venta >= p2.precio_venta) ? p1 : p2;
    onConfirm({
      producto_id: caro.id,
      sku: caro.sku,
      display_name: "Pizza mitad y mitad",
      precio_unitario: precio,
      mitad: { producto1_id: p1.id, producto2_id: p2.id, nombre1: p1.nombre, nombre2: p2.nombre },
    });
  }

  if (!open) return null;
  const selectClass = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#0EA5E9]";

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center bg-slate-900/60 px-3 pt-12 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-800">🍕 Pizza mitad y mitad</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="space-y-3 p-4">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">⚠ {error}</div>}
          {loading ? (
            <p className="py-6 text-center text-sm text-slate-400">Cargando pizzas…</p>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Mitad 1 — sabor</label>
                <select value={s1} onChange={(e) => setS1(e.target.value)} className={selectClass}>
                  <option value="">Elegí un sabor…</option>
                  {pizzas.map((p) => <option key={p.id} value={p.id}>{p.nombre} — {formatGs(p.precio_venta)}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Mitad 2 — sabor</label>
                <select value={s2} onChange={(e) => setS2(e.target.value)} className={selectClass}>
                  <option value="">Elegí un sabor…</option>
                  {pizzas.map((p) => <option key={p.id} value={p.id}>{p.nombre} — {formatGs(p.precio_venta)}</option>)}
                </select>
              </div>

              {valido && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                  <p className="font-semibold text-slate-800">Pizza mitad y mitad</p>
                  <p className="text-xs text-slate-600">½ {p1!.nombre} + ½ {p2!.nombre}</p>
                  <p className="mt-1 text-xs text-slate-500">Precio = sabor más caro</p>
                  <p className="text-lg font-extrabold tabular-nums text-slate-900">{formatGs(precio)}</p>
                </div>
              )}

              <button
                type="button"
                onClick={confirmar}
                disabled={!valido}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                Agregar pizza mitad y mitad
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
