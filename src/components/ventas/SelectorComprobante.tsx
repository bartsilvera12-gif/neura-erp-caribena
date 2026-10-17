"use client";

import ReceptorFactura, {
  receptorAPayload,
  validarReceptor,
  type DatosReceptor,
} from "@/components/ventas/ReceptorFactura";
import {
  avisoTopeFacturaSinNombre,
  superaTopeFacturaSinNombre,
  TOPE_FACTURA_SIN_NOMBRE_GS,
} from "@/lib/facturacion/factura-sin-nombre";

/**
 * Elegir entre ticket y factura al cobrar, con los datos que el SET exige
 * cuando la piden.
 *
 * Vive en un componente propio porque lo usan la caja y el cobro de mesa, y
 * son el mismo momento del negocio: el cliente dice "con factura" y hay que
 * pedirle el RUC. Si cada pantalla tuviera su copia, tarde o temprano una
 * validaría distinto que la otra y habría facturas emitidas con datos que la
 * otra pantalla habría rechazado.
 *
 * Hay tres opciones:
 *  - Ticket: sin datos del cliente, no es documento fiscal.
 *  - Factura sin nombre: el cliente no pide factura ni da datos, pero igual se
 *    factura. Sale como receptor innominado ("Sin Nombre"), hasta el tope.
 *  - Factura: a nombre de un RUC, cuando el cliente la pide.
 */
export type TipoComprobante = "ticket" | "factura_sin_nombre" | "factura";

export interface SelectorComprobanteProps {
  valor: TipoComprobante;
  onChange: (v: TipoComprobante) => void;
  receptor: DatosReceptor;
  onReceptorChange: (r: DatosReceptor) => void;
  /** Total a facturar (Gs). Necesario para el tope de la factura sin nombre. */
  total?: number;
}

const OPCIONES = [
  { v: "ticket" as const, label: "Ticket", nota: "Sin datos del cliente" },
  { v: "factura_sin_nombre" as const, label: "Factura sin nombre", nota: "Sin pedir RUC" },
  { v: "factura" as const, label: "Factura", nota: "Necesita RUC" },
];

/** true si el comprobante elegido es alguna de las dos facturas. */
export function esFactura(tipo: TipoComprobante): boolean {
  return tipo === "factura" || tipo === "factura_sin_nombre";
}

/**
 * true si se puede cobrar:
 *  - ticket siempre;
 *  - factura sin nombre, mientras el total no supere el tope;
 *  - factura, sólo con datos de receptor válidos.
 */
export function comprobanteListo(
  tipo: TipoComprobante,
  receptor: DatosReceptor,
  total?: number
): boolean {
  if (tipo === "ticket") return true;
  if (tipo === "factura_sin_nombre") {
    return total == null || !superaTopeFacturaSinNombre(total);
  }
  return validarReceptor(receptor) === null;
}

/** Cuerpo para POST /api/ventas/[id]/facturar según el comprobante elegido. */
export function comprobanteAPayload(
  tipo: TipoComprobante,
  receptor: DatosReceptor
): Record<string, string | boolean> {
  if (tipo === "factura_sin_nombre") return { sin_nombre: true };
  return receptorAPayload(receptor);
}

export default function SelectorComprobante({
  valor,
  onChange,
  receptor,
  onReceptorChange,
  total,
}: SelectorComprobanteProps) {
  const aviso = valor === "factura" ? validarReceptor(receptor) : null;
  const superaTope =
    valor === "factura_sin_nombre" && total != null && superaTopeFacturaSinNombre(total);

  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {OPCIONES.map((opt) => (
          <label
            key={opt.v}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
              valor === opt.v
                ? "border-amber-500 bg-white font-medium text-amber-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name="comprobante"
              value={opt.v}
              checked={valor === opt.v}
              onChange={() => onChange(opt.v)}
              className="h-4 w-4 text-amber-600 focus:ring-amber-500"
            />
            <span>
              {opt.label}
              <span className="ml-1.5 text-xs font-normal text-slate-400">{opt.nota}</span>
            </span>
          </label>
        ))}
      </div>

      {valor === "factura_sin_nombre" && (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
          Sale como <strong>&ldquo;Sin Nombre&rdquo;</strong> (consumidor final), sin pedir RUC.
          Válido hasta Gs. {TOPE_FACTURA_SIN_NOMBRE_GS.toLocaleString("es-PY")}.
          {superaTope && (
            <p className="mt-1.5 font-medium text-amber-700">{avisoTopeFacturaSinNombre()}</p>
          )}
        </div>
      )}

      {valor === "factura" && (
        <div className="mt-4">
          <ReceptorFactura valor={receptor} onChange={onReceptorChange} />
          {aviso && <p className="mt-2 text-xs text-amber-700">{aviso}</p>}
        </div>
      )}
    </div>
  );
}
