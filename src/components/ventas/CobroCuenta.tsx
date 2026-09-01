"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";
import SelectField from "@/components/ui/SelectField";
import { confirmar } from "@/components/ui/ConfirmDialog";
import CobroRepartido, {
  cobroValido,
  montoDeLinea,
  totalCobrado,
  type LineaCobro,
} from "@/components/ventas/CobroRepartido";
import SelectorComprobante, {
  comprobanteListo,
  type TipoComprobante,
} from "@/components/ventas/SelectorComprobante";
import {
  RECEPTOR_VACIO,
  receptorAPayload,
  type DatosReceptor,
} from "@/components/ventas/ReceptorFactura";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { facturarMesa, type PagoConciliacionInput } from "@/lib/mesas/storage";
import { abrirCaja, getCajaAbierta } from "@/lib/caja/storage";
import { getCuentasBancarias } from "@/lib/conciliacion/storage";
import type { CuentaBancaria } from "@/lib/conciliacion/types";

/**
 * Cobro de una cuenta: formas de pago, comprobante y confirmación.
 *
 * Vive en un componente propio porque se cobra desde dos lados —la mesa en el
 * salón y el listado de pendientes en caja— y son el mismo acto. Con una copia
 * en cada pantalla, cualquier arreglo habría que hacerlo dos veces y tarde o
 * temprano una cobraría distinto que la otra.
 */
type Metodo = "efectivo" | "tarjeta" | "transferencia" | "qr";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

export interface CobroCuentaProps {
  sesionId: string;
  total: number;
  /** Productos cargados que todavía no salieron a cocina. */
  pendientes: number;
  /** Se puede cobrar (hay productos y la cuenta sigue abierta). */
  habilitado: boolean;
  /** A dónde volver después de cobrar con ticket. */
  volverA: string;
  onError: (msg: string) => void;
}

export default function CobroCuenta({
  sesionId,
  total,
  pendientes,
  habilitado,
  volverA,
  onError,
}: CobroCuentaProps) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [sinCaja, setSinCaja] = useState(false);
  const [montoApertura, setMontoApertura] = useState(0);
  const [abriendoCaja, setAbriendoCaja] = useState(false);
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);

  const [comprobante, setComprobante] = useState<TipoComprobante>("ticket");
  const [receptor, setReceptor] = useState<DatosReceptor>(RECEPTOR_VACIO);

  /**
   * Formas de pago del cobro. Arranca en una sola —efectivo— porque así se
   * cobra casi siempre; el monto de esa única línea lo cubre el total.
   */
  const [lineasCobro, setLineasCobro] = useState<LineaCobro[]>([
    { key: "p0", metodo: "efectivo", monto: "" },
  ]);
  const metodo: Metodo = lineasCobro[0]?.metodo ?? "efectivo";
  const [montoRecibido, setMontoRecibido] = useState("");
  const [pago, setPago] = useState<PagoConciliacionInput>({});

  useEffect(() => { getCuentasBancarias().then(setCuentas); }, []);
  useEffect(() => { getCajaAbierta().then((c) => setSinCaja(!c)); }, []);

  const montoRecibidoNum = parseFloat(montoRecibido) || 0;
  const aPagarEnEfectivo =
    lineasCobro.length > 1
      ? totalCobrado(lineasCobro.filter((l) => l.metodo === "efectivo"))
      : total;
  const vuelto = montoRecibidoNum - aPagarEnEfectivo;

  /** Abre la caja del turno sin salir de la cuenta que se está cobrando. */
  async function onAbrirCaja() {
    const monto = Number.isFinite(montoApertura) ? montoApertura : 0;
    setAbriendoCaja(true);
    const r = await abrirCaja(monto, null);
    setAbriendoCaja(false);
    if (!r.success) { onError(r.error); return; }
    setSinCaja(false);
  }

  async function cobrar() {
    if (!habilitado || sinCaja) return;
    if (!comprobanteListo(comprobante, receptor)) return;

    // Cobrar algo que la cocina nunca recibió es cobrarle al cliente comida que
    // no se va a preparar. Se avisa antes, no después.
    if (pendientes > 0) {
      const seguir = await confirmar(
        `Hay ${pendientes} producto(s) que no se enviaron a cocina. Si cobrás ahora, la cocina no los va a recibir.`,
        { confirmLabel: "Cobrar igual", cancelLabel: "Volver" }
      );
      if (!seguir) return;
    }
    if (!cobroValido(lineasCobro, total)) {
      onError(`El cobro suma ${formatGs(totalCobrado(lineasCobro))} y la cuenta es de ${formatGs(total)}.`);
      return;
    }

    setBusy(true);
    // Pre-abrir la pestaña del ticket dentro del gesto del usuario, si no el
    // navegador la bloquea por no venir de un clic.
    let ticketWin: Window | null = null;
    try { ticketWin = window.open("about:blank", "_blank"); } catch { ticketWin = null; }

    const repartido = lineasCobro.length > 1;
    // Con cobro repartido los datos de conciliación aplican a las líneas que no
    // son efectivo, que es donde hay algo que contrastar después.
    const hayNoEfectivo = lineasCobro.some((l) => l.metodo !== "efectivo");
    const r = await facturarMesa(
      sesionId,
      metodo,
      hayNoEfectivo ? { ...pago, fecha_pago: pago.fecha_pago || new Date().toISOString() } : null,
      repartido
        ? lineasCobro.filter((l) => montoDeLinea(l) > 0).map((l) => ({ metodo_pago: l.metodo, monto: montoDeLinea(l) }))
        : []
    );
    setBusy(false);

    if (!r.success) {
      try { ticketWin?.close(); } catch { /* nada que cerrar */ }
      onError(r.error);
      return;
    }

    // Con factura el comprobante es el KUDE, no el ticket: se emite acá mismo y
    // la pantalla del documento lo abre sola al aprobarse.
    if (comprobante === "factura") {
      try { ticketWin?.close(); } catch { /* la pestaña ya no hace falta */ }
      try {
        const res = await fetchWithSupabaseSession(`/api/ventas/${r.ventaId}/facturar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(receptorAPayload(receptor)),
        });
        const body = await res.json();
        if (res.ok && body?.success !== false && body?.data?.facturaId) {
          router.push(`/facturas/${body.data.facturaId}?kude=1&auto=1`);
          return;
        }
        // El cobro ya ocurrió; sólo falló la emisión. No se vuelve atrás: el
        // dinero entró y la mesa quedó liberada.
        onError(
          `La cuenta se cobró, pero no se pudo emitir la factura: ${body?.error ?? `error ${res.status}`}. Emitila desde el listado de ventas.`
        );
        return;
      } catch (e) {
        onError(
          `La cuenta se cobró, pero no se pudo emitir la factura: ${e instanceof Error ? e.message : "error de red"}. Emitila desde el listado de ventas.`
        );
        return;
      }
    }

    const href = `/api/ventas/${r.ventaId}/ticket?copia=cliente&auto=1`;
    try {
      if (ticketWin) ticketWin.location.href = href;
      else window.open(href, "_blank", "noopener");
    } catch { /* el ticket queda disponible desde la venta */ }
    router.push(volverA);
  }

  const puedeCobrar = habilitado && !sinCaja && !busy && comprobanteListo(comprobante, receptor);

  return (
    <div className="space-y-4">
      {/* La caja se abre acá mismo: mandar al cajero a otra pantalla con el
          cliente esperando era el paso más absurdo del recorrido. */}
      {sinCaja && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">
            <AlertTriangle className="inline h-4 w-4 align-[-0.125em]" aria-hidden /> No hay caja abierta.
            Abrila acá con el efectivo con el que arrancás el turno.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-amber-900">Monto de apertura</label>
              <MontoInput value={montoApertura} onChange={setMontoApertura} placeholder="Ej: 100.000" />
            </div>
            <button
              type="button"
              disabled={abriendoCaja}
              onClick={() => void onAbrirCaja()}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-40"
            >
              {abriendoCaja ? "Abriendo…" : "Abrir caja"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Cobro</p>

        <div>
          <label className="mb-1 block text-xs text-gray-600">Método de pago</label>
          <CobroRepartido
            lineas={lineasCobro}
            onChange={(l) => { setLineasCobro(l); setPago({}); }}
            total={total}
            inputClass={inputClass}
          />
        </div>

        {lineasCobro.some((l) => l.metodo === "efectivo") && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Monto recibido</label>
              <MontoInput value={montoRecibido} onChange={(v) => setMontoRecibido(String(v))} placeholder="Ej: 100.000" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Vuelto</label>
              <p className={`px-3 py-2 text-sm font-semibold tabular-nums ${vuelto < 0 ? "text-red-600" : "text-emerald-700"}`}>
                {montoRecibidoNum > 0 ? formatGs(vuelto) : "—"}
              </p>
            </div>
          </div>
        )}

        {(metodo === "transferencia" || metodo === "qr") && cuentas.length > 0 && (
          <div>
            <label className="mb-1 block text-xs text-gray-600">Cuenta que recibe</label>
            <SelectField
              value={pago.cuenta_bancaria_id ?? ""}
              onChange={(e) => setPago((p) => ({ ...p, cuenta_bancaria_id: e.target.value || null }))}
              className={inputClass}
            >
              <option value="">Cuenta destino…</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.banco ? ` (${c.banco})` : ""}
                </option>
              ))}
            </SelectField>
          </div>
        )}

        {(metodo === "tarjeta" || metodo === "transferencia" || metodo === "qr") && (
          <>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Referencia</label>
              <input
                value={pago.referencia ?? ""}
                onChange={(e) => setPago((p) => ({ ...p, referencia: e.target.value }))}
                placeholder="N° de operación"
                className={inputClass}
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Queda como conciliación <strong>pendiente</strong>. No suma al efectivo esperado.
            </p>
          </>
        )}
      </div>

      {/* El comprobante se decide antes de cobrar, no después */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Comprobante</p>
        <SelectorComprobante
          valor={comprobante}
          onChange={setComprobante}
          receptor={receptor}
          onReceptorChange={setReceptor}
        />
      </div>

      <button
        type="button"
        onClick={() => void cobrar()}
        disabled={!puedeCobrar}
        className="w-full rounded-xl bg-emerald-600 px-5 py-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Cobrando…" : comprobante === "factura" ? "Cobrar y facturar" : "Cobrar"}
      </button>
    </div>
  );
}
