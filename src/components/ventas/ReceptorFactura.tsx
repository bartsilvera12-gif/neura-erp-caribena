"use client";

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
 * Se usa igual desde la venta nueva y desde el listado, para que el cajero vea
 * lo mismo en los dos lados.
 */

export type TipoReceptor = "ruc" | "ci";

export interface DatosReceptor {
  tipo: TipoReceptor;
  ruc: string;
  documento: string;
  razonSocial: string;
}

export const RECEPTOR_VACIO: DatosReceptor = {
  tipo: "ruc",
  ruc: "",
  documento: "",
  razonSocial: "",
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
export function receptorAPayload(d: DatosReceptor): Record<string, string> {
  if (d.tipo === "ruc") {
    return { ruc: d.ruc.trim(), razon_social: d.razonSocial.trim() };
  }
  return { documento: d.documento.trim(), razon_social: d.razonSocial.trim() };
}

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

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {OPCIONES.map((o) => (
          <button
            key={o.v}
            type="button"
            disabled={disabled}
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
              disabled={disabled}
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
              disabled={disabled}
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

      {valor.tipo === "ruc" && (
        <p className="text-xs text-slate-400">
          Con RUC el documento sale como contribuyente. Si la persona no está inscripta en
          Marangatú, cargala con cédula: el SET rechaza el RUC que no figura en el padrón.
        </p>
      )}
    </div>
  );
}
