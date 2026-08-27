"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Pide los datos del receptor y emite la factura de una venta ya cobrada.
 *
 * Sólo aparece cuando el cliente pide factura: la venta se cobra y se imprime
 * su ticket sin pasar por acá. Ver el porqué en facturar-venta-pg.
 *
 * Consumidor final es una opción de primera clase y no un olvido: es el caso
 * más común en el mostrador, y el SET lo acepta sin RUC ni nombre.
 */
export default function FacturarVentaModal({
  ventaId,
  numeroControl,
  total,
  onClose,
  onEmitida,
}: {
  ventaId: string;
  numeroControl: string;
  total: number;
  onClose: () => void;
  /** Recibe el id de la factura emitida para llevar al detalle. */
  onEmitida: (facturaId: string) => void;
}) {
  const [conRuc, setConRuc] = useState(true);
  const [ruc, setRuc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape" && !enviando) onClose();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose, enviando]);

  async function emitir() {
    setError(null);
    if (conRuc && !ruc.trim()) return setError("Ingresá el RUC del cliente.");
    if (conRuc && !razonSocial.trim()) return setError("Ingresá la razón social del cliente.");

    setEnviando(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/ventas/${ventaId}/facturar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          conRuc ? { ruc: ruc.trim(), razon_social: razonSocial.trim() } : {}
        ),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        // Si ya estaba facturada, en vez de un error a secas la llevamos.
        const yaId = body?.data?.factura_id;
        if (res.status === 409 && yaId) {
          onEmitida(String(yaId));
          return;
        }
        setError(body?.error ?? "No se pudo emitir la factura.");
        return;
      }
      onEmitida(String(body.data.factura_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setEnviando(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={() => !enviando && onClose()}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/30"
        />
        <div className="px-5 pb-4 pt-5">
          <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <FileText className="h-5 w-5 text-[#4FAEB2]" aria-hidden />
            Facturar {numeroControl}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Por Gs. {Math.round(total).toLocaleString("es-PY")}. Se emite la factura del ERP;
            el envío al SET se hace después, desde el detalle.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setConRuc(true); setError(null); }}
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                conRuc
                  ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Con RUC
            </button>
            <button
              type="button"
              onClick={() => { setConRuc(false); setError(null); }}
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                !conRuc
                  ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Consumidor final
            </button>
          </div>

          {conRuc ? (
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  RUC
                </label>
                <input
                  autoFocus
                  value={ruc}
                  onChange={(e) => setRuc(e.target.value)}
                  placeholder="Ej: 80012345-6"
                  maxLength={20}
                  disabled={enviando}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Razón social
                </label>
                <input
                  value={razonSocial}
                  onChange={(e) => setRazonSocial(e.target.value)}
                  placeholder="Nombre o empresa que figura en el RUC"
                  maxLength={250}
                  disabled={enviando}
                  className={inputCls}
                  onKeyDown={(e) => { if (e.key === "Enter") void emitir(); }}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
              La factura sale sin RUC ni nombre. Es lo que corresponde cuando el cliente no
              pide factura a su nombre.
            </p>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600">
              <AlertTriangle className="inline h-4 w-4 align-[-0.125em]" aria-hidden /> {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
          <button
            type="button"
            disabled={enviando}
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200/60 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={enviando}
            onClick={emitir}
            className="rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {enviando ? "Emitiendo…" : "Emitir factura"}
          </button>
        </div>
      </div>
    </div>
  );
}
