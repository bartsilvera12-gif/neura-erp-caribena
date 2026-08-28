"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Search, UserPlus, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Datos del receptor de una factura, tal como se piden en el mostrador.
 *
 * Son dos casos y no un formulario libre porque el XML del SET los trata
 * distinto: con RUC el documento sale como contribuyente (B2B) y con cédula
 * como consumidor final identificado (B2C). Mandar un RUC de alguien que no es
 * contribuyente hace que la SET rechace el lote entero.
 *
 * No hay opción "sin datos": el documento electrónico siempre lleva
 * identificación del receptor. Para una venta sin datos está el ticket.
 *
 * Primero busca entre los clientes ya cargados — al que factura seguido no hay
 * que tipearle el RUC cada vez — y si no está, lo carga en el momento y queda
 * guardado para la próxima.
 *
 * Se usa igual desde la venta nueva y desde el listado, para que el cajero vea
 * lo mismo en los dos lados.
 */

export type TipoReceptor = "ruc" | "ci";

export interface DatosReceptor {
  tipo: TipoReceptor;
  ruc: string;
  documento: string;
  razonSocial: string;
  /** Cliente ya cargado que se eligió del buscador. */
  clienteId: string | null;
  /** Guardar en Clientes al facturar. Sólo aplica si no vino de la búsqueda. */
  guardar: boolean;
}

export const RECEPTOR_VACIO: DatosReceptor = {
  tipo: "ruc",
  ruc: "",
  documento: "",
  razonSocial: "",
  clienteId: null,
  guardar: true,
};

/** Qué falta para poder emitir. null = está listo. */
export function validarReceptor(d: DatosReceptor): string | null {
  if (d.tipo === "ruc") {
    if (!d.ruc.trim()) return "Ingresá el RUC del cliente.";
    if (!d.razonSocial.trim()) return "Ingresá la razón social del cliente.";
    return null;
  }
  if (!d.documento.trim()) return "Ingresá la cédula del cliente.";
  if (!d.razonSocial.trim()) return "Ingresá el nombre del cliente.";
  return null;
}

/** Cuerpo que espera /api/ventas/[id]/facturar. */
export function receptorAPayload(d: DatosReceptor): Record<string, string | boolean> {
  const base: Record<string, string | boolean> = { razon_social: d.razonSocial.trim() };
  if (d.tipo === "ruc") base.ruc = d.ruc.trim();
  else base.documento = d.documento.trim();
  // Un cliente ya cargado se referencia; uno nuevo se guarda si lo pidieron.
  if (d.clienteId) base.cliente_id = d.clienteId;
  else base.guardar_cliente = d.guardar;
  return base;
}

type ClienteHit = {
  id: string;
  razon_social: string;
  ruc: string | null;
  documento: string | null;
  es_contribuyente: boolean;
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

const OPCIONES: Array<{ v: TipoReceptor; label: string }> = [
  { v: "ruc", label: "Con RUC" },
  { v: "ci", label: "Con cédula" },
];

export default function ReceptorFactura({
  valor,
  onChange,
  disabled,
  autoFocus,
}: {
  valor: DatosReceptor;
  onChange: (d: DatosReceptor) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const set = (parcial: Partial<DatosReceptor>) => onChange({ ...valor, ...parcial });

  const [busqueda, setBusqueda] = useState("");
  const [hits, setHits] = useState<ClienteHit[]>([]);
  const [buscando, setBuscando] = useState(false);
  const cajaRef = useRef<HTMLDivElement>(null);

  // Se espera a que deje de tipear: en el mostrador se escribe rápido y una
  // consulta por tecla no le sirve a nadie.
  useEffect(() => {
    const q = busqueda.trim();
    if (q.length < 2) { setHits([]); return; }
    let cancelado = false;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetchWithSupabaseSession(
          `/api/clientes/buscar?q=${encodeURIComponent(q)}`,
          { cache: "no-store" }
        );
        const body = await res.json();
        if (!cancelado) setHits(res.ok && body?.success !== false ? body.data.clientes : []);
      } catch {
        if (!cancelado) setHits([]);
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 250);
    return () => { cancelado = true; clearTimeout(t); };
  }, [busqueda]);

  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (!cajaRef.current?.contains(e.target as Node)) setHits([]);
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  function elegir(c: ClienteHit) {
    // El tipo sale de lo que tiene cargado el cliente, no de lo que estaba
    // elegido antes: es el dato con el que se va a armar el documento.
    const conRuc = !!c.ruc && c.es_contribuyente;
    onChange({
      tipo: conRuc ? "ruc" : "ci",
      ruc: conRuc ? c.ruc ?? "" : "",
      documento: conRuc ? "" : c.documento ?? c.ruc ?? "",
      razonSocial: c.razon_social,
      clienteId: c.id,
      guardar: false,
    });
    setBusqueda("");
    setHits([]);
  }

  function soltarCliente() {
    set({ clienteId: null, guardar: true });
  }

  return (
    <div className="space-y-3">
      {/* Buscador de clientes ya cargados */}
      {valor.clienteId ? (
        <div className="flex items-center gap-2 rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/10 px-3 py-2.5 text-sm">
          <Check className="h-4 w-4 shrink-0 text-[#3F8E91]" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium text-[#2F6E71]">
            Cliente cargado: {valor.razonSocial}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={soltarCliente}
            className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700 disabled:opacity-50"
            aria-label="Quitar el cliente elegido"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <div ref={cajaRef} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={busqueda}
            disabled={disabled}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente por nombre, RUC o cédula…"
            className={`${inputCls} pl-9`}
          />
          {hits.length > 0 && (
            <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {hits.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); elegir(c); }}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-[#4FAEB2]/10"
                  >
                    <span className="font-medium text-slate-800">{c.razon_social}</span>
                    <span className="text-xs text-slate-500">
                      {c.ruc ? `RUC ${c.ruc}` : c.documento ? `CI ${c.documento}` : "Sin identificación"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {busqueda.trim().length >= 2 && !buscando && hits.length === 0 && (
            <p className="mt-1.5 text-xs text-slate-400">
              No hay ningún cliente con eso. Cargá los datos abajo y se guarda solo.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {OPCIONES.map((o) => (
          <button
            key={o.v}
            type="button"
            disabled={disabled || !!valor.clienteId}
            onClick={() => set({ tipo: o.v })}
            className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              valor.tipo === o.v
                ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>{valor.tipo === "ruc" ? "RUC" : "Cédula"}</label>
          <input
            autoFocus={autoFocus}
            disabled={disabled || !!valor.clienteId}
            value={valor.tipo === "ruc" ? valor.ruc : valor.documento}
            onChange={(e) =>
              set(valor.tipo === "ruc" ? { ruc: e.target.value } : { documento: e.target.value })
            }
            placeholder={valor.tipo === "ruc" ? "Ej: 80012345-6" : "Ej: 4123456"}
            maxLength={20}
            inputMode={valor.tipo === "ci" ? "numeric" : "text"}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>
            {valor.tipo === "ruc" ? "Razón social" : "Nombre y apellido"}
          </label>
          <input
            disabled={disabled || !!valor.clienteId}
            value={valor.razonSocial}
            onChange={(e) => set({ razonSocial: e.target.value })}
            placeholder={
              valor.tipo === "ruc" ? "Nombre que figura en el RUC" : "Como figura en la cédula"
            }
            maxLength={250}
            className={inputCls}
          />
        </div>
      </div>

      {/* Guardar en Clientes: sólo tiene sentido si no vino de la búsqueda. */}
      {!valor.clienteId && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            disabled={disabled}
            checked={valor.guardar}
            onChange={(e) => set({ guardar: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]"
          />
          <UserPlus className="h-4 w-4 text-slate-400" aria-hidden />
          Guardar en Clientes para la próxima vez
        </label>
      )}

      {valor.tipo === "ruc" && !valor.clienteId && (
        <p className="text-xs text-slate-400">
          Con RUC el documento sale como contribuyente. Si la persona no está inscripta en
          Marangatú, cargala con cédula: el SET rechaza el RUC que no figura en el padrón.
        </p>
      )}
    </div>
  );
}
