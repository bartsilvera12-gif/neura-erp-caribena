"use client";

import SelectField from "@/components/ui/SelectField";
import { AlertTriangle, Pizza } from "lucide-react";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmar } from "@/components/ui/ConfirmDialog";
import ProductPickerModal, { type AgregarVentaPayload } from "@/components/inventario/ProductPickerModal";
import MitadMitadPicker, { type MitadMitadResult } from "@/components/ventas/MitadMitadPicker";
import MontoInput from "@/components/ui/MontoInput";
import { calcularLineaVenta } from "@/lib/ventas/iva";
import { actualizarItemCaja, agregarItemCaja, getSesionPorCobrar } from "@/lib/ventas/por-cobrar";
import CobroRepartido, {
  cobroValido,
  montoDeLinea,
  totalCobrado,
  type LineaCobro,
} from "@/components/ventas/CobroRepartido";
import { enviarComandaSesion, facturarMesa, type PagoConciliacionInput } from "@/lib/mesas/storage";
import { abrirCaja, getCajaAbierta } from "@/lib/caja/storage";
import SelectorComprobante, {
  comprobanteListo,
  type TipoComprobante,
} from "@/components/ventas/SelectorComprobante";
import { RECEPTOR_VACIO, receptorAPayload, type DatosReceptor } from "@/components/ventas/ReceptorFactura";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getCuentasBancarias } from "@/lib/conciliacion/storage";
import type { MesaDetalle } from "@/lib/mesas/types";
import type { CuentaBancaria } from "@/lib/conciliacion/types";

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatGs(v: number) { return `Gs. ${Math.round(v).toLocaleString("es-PY")}`; }
type Metodo = "efectivo" | "tarjeta" | "transferencia" | "qr";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">{children}</p>;
}

/**
 * Checkout de mesa — MISMA experiencia que "Nueva venta" de Caja, pero con los
 * ítems de la mesa precargados. Reutiliza el buscador de productos de Caja
 * (ProductPickerModal), el desglose IVA incluido, la lógica de cobro
 * (efectivo/tarjeta/transferencia/QR + conciliación) y el ticket de venta.
 *
 * El "carrito" es el estado persistido de la sesión (mesa_sesion_items): agregar,
 * cambiar cantidad y quitar pasan por los endpoints de edición de caja, de modo
 * que `facturarMesa` (transaccional, idempotente, asocia caja_id + libera mesa)
 * factura exactamente lo que se ve en pantalla. NO se duplica lógica de venta.
 */
export default function FacturarMesaPage({ params }: { params: Promise<{ sesionId: string }> }) {
  const { sesionId } = use(params);
  const router = useRouter();

  const [detalle, setDetalle] = useState<MesaDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [yaFacturada, setYaFacturada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sinCaja, setSinCaja] = useState(false);
  /**
   * Ticket o factura, decidido acá mismo. Antes había que cobrar, salir, buscar
   * la venta y recién ahí facturarla: cuatro pantallas para algo que el cliente
   * pide en una frase.
   */
  const [comprobante, setComprobante] = useState<TipoComprobante>("ticket");
  const [receptor, setReceptor] = useState<DatosReceptor>(RECEPTOR_VACIO);
  const [montoApertura, setMontoApertura] = useState(0);
  const [abriendoCaja, setAbriendoCaja] = useState(false);
  const [comandando, setComandando] = useState(false);
  const [okComanda, setOkComanda] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [mitadOpen, setMitadOpen] = useState(false);
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);

  // Cobro
  /**
   * Formas de pago del cobro. Arranca en una sola —efectivo— porque así se
   * cobra casi siempre; el monto de esa única línea lo cubre el total.
   */
  const [lineasCobro, setLineasCobro] = useState<LineaCobro[]>([
    { key: "p0", metodo: "efectivo", monto: "" },
  ]);
  const metodo: Metodo = lineasCobro[0]?.metodo ?? "efectivo";
  const setMetodo = (m: Metodo) =>
    setLineasCobro((prev) => (prev.length ? [{ ...prev[0], metodo: m }, ...prev.slice(1)] : prev));
  const [montoRecibido, setMontoRecibido] = useState("");
  const [pago, setPago] = useState<PagoConciliacionInput>({});

  const reload = useCallback(async () => {
    const d = await getSesionPorCobrar(sesionId);
    if (!d) { setNotFound(true); setDetalle(null); }
    else {
      setDetalle(d);
      // Si la sesión ya tiene venta o no está editable, marcar.
      if (d.sesion && d.sesion.venta_id) setYaFacturada(true);
    }
    setLoading(false);
  }, [sesionId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { getCuentasBancarias().then(setCuentas); }, []);
  useEffect(() => { getCajaAbierta().then((c) => setSinCaja(!c)); }, []);

  const items = detalle?.items ?? [];
  /** Productos cargados que todavia no salieron a cocina. */
  const pendientes = items.filter((i) => i.estado === "pendiente").length;
  const mesaNumero = detalle?.mesa.numero ?? null;

  // ── Totales (IVA INCLUIDO 10% — misma fórmula que facturarSesionPg) ──────────
  let subtotal = 0, ivaTotal = 0, total = 0;
  for (const it of items) {
    const d = calcularLineaVenta(it.precio_unitario, it.cantidad, "10%");
    subtotal += d.subtotal; ivaTotal += d.monto_iva; total += d.total_linea;
  }
  const montoRecibidoNum = parseFloat(montoRecibido) || 0;
  const aPagarEnEfectivo =
    lineasCobro.length > 1
      ? totalCobrado(lineasCobro.filter((l) => l.metodo === "efectivo"))
      : total;
  const vuelto = montoRecibidoNum - aPagarEnEfectivo;

  // ── Operaciones sobre el carrito (persistidas en la sesión) ──────────────────
  function handleAgregarDesdePicker(payload: AgregarVentaPayload): boolean {
    const { producto, cantidad, precio_input } = payload;
    // Persistir async; el modal se queda abierto para seguir cargando.
    agregarItemCaja(sesionId, {
      producto_id: producto.id, cantidad, observacion: null, precio_unitario: precio_input,
    }).then((r) => {
      if (!r.success) setError(r.error);
      else { setError(null); reload(); }
    });
    return true;
  }

  function handleAgregarMitad(r: MitadMitadResult) {
    agregarItemCaja(sesionId, {
      producto_id: r.producto_id, cantidad: 1, observacion: null,
      precio_unitario: r.precio_unitario, display_name: r.display_name, mitad: r.mitad,
    }).then((res) => {
      if (!res.success) setError(res.error);
      else { setError(null); reload(); }
    });
    setMitadOpen(false);
  }

  async function changeQty(itemId: string, nueva: number) {
    if (nueva < 1) return;
    setError(null);
    const r = await actualizarItemCaja(itemId, { cantidad: nueva });
    if (!r.success) { setError(r.error); return; }
    reload();
  }

  async function removeItem(itemId: string) {
    setError(null);
    const r = await actualizarItemCaja(itemId, { cancelar: true });
    if (!r.success) { setError(r.error); return; }
    reload();
  }

  /**
   * Manda a cocina lo que se agregó en esta pantalla.
   *
   * Es explícito y no automático: al cobrar se agrega y se corrige, y la cocina
   * tiene que recibir sólo lo que alguien decidió mandar. Un plato que salió a
   * la parrilla por un tipeo no vuelve.
   */
  async function onEnviarACocina() {
    setComandando(true);
    setError(null);
    setOkComanda(null);
    const r = await enviarComandaSesion(sesionId);
    setComandando(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    if (r.sin_produccion || r.comandas.length === 0) {
      setOkComanda("No había productos que requieran cocina.");
    } else {
      const partes = r.comandas.map(
        (c) => `${c.sector === "pizzeria" ? "Pizzería" : "Plancha"} N°${c.numero}`
      );
      setOkComanda(`Enviado a cocina: ${partes.join(" · ")}.`);
    }
    await reload();
    setTimeout(() => setOkComanda(null), 4000);
  }

  /** Abre la caja del turno sin salir de la cuenta que se está cobrando. */
  async function onAbrirCaja() {
    const monto = Number.isFinite(montoApertura) ? montoApertura : 0;
    setAbriendoCaja(true);
    setError(null);
    const r = await abrirCaja(monto, null);
    setAbriendoCaja(false);
    if (!r.success) { setError(r.error); return; }
    setSinCaja(false);
  }

  // ── Confirmar venta ──────────────────────────────────────────────────────────
  async function facturar() {
    if (!detalle || items.length === 0 || sinCaja) return;
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
      setError(
        `El cobro suma ${formatGs(totalCobrado(lineasCobro))} y la cuenta es de ${formatGs(total)}.`
      );
      return;
    }
    setError(null); setBusy(true);

    // Pre-abrir la pestaña del ticket dentro del gesto del usuario (evita bloqueo de pop-ups).
    let ticketWin: Window | null = null;
    try { ticketWin = window.open("about:blank", "_blank"); } catch { ticketWin = null; }

    const repartido = lineasCobro.length > 1;
    // Con cobro repartido los datos de conciliación se cargan igual: aplican a
    // las líneas que no son efectivo, que es donde hay algo que contrastar.
    const hayNoEfectivo = lineasCobro.some((l) => l.metodo !== "efectivo");
    const r = await facturarMesa(
      sesionId,
      metodo,
      hayNoEfectivo ? { ...pago, fecha_pago: pago.fecha_pago || new Date().toISOString() } : null,
      repartido
        ? lineasCobro
            .filter((l) => montoDeLinea(l) > 0)
            .map((l) => ({ metodo_pago: l.metodo, monto: montoDeLinea(l) }))
        : []
    );
    setBusy(false);

    if (!r.success) {
      try { ticketWin?.close(); } catch {}
      setError(r.error);
      return;
    }
    // Con factura el comprobante es el KUDE, no el ticket: se emite acá mismo y
    // la pantalla del documento lo abre sola al aprobarse. Es el mismo camino
    // que usa la caja, para que una mesa y un mostrador no facturen distinto.
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
        // La venta ya se cobró; sólo falló la factura. Se avisa sin volver
        // atrás: el dinero entró y la mesa quedó liberada.
        setError(
          `La mesa se cobró, pero no se pudo emitir la factura: ${body?.error ?? `error ${res.status}`}. Emitila desde el listado de ventas.`
        );
        return;
      } catch (e) {
        setError(
          `La mesa se cobró, pero no se pudo emitir la factura: ${e instanceof Error ? e.message : "error de red"}. Emitila desde el listado de ventas.`
        );
        return;
      }
    }

    // Apuntar la pestaña al ticket de venta (mismo ticket de Caja, auto-impresión).
    const href = `/api/ventas/${r.ventaId}/ticket?copia=cliente&auto=1`;
    try {
      if (ticketWin) ticketWin.location.href = href;
      else window.open(href, "_blank", "noopener");
    } catch {}
    router.push("/ventas/mesas-por-cobrar");
  }

  // ── Estados de carga / error ─────────────────────────────────────────────────
  if (loading) return <p className="py-16 text-center text-slate-400">Cargando cuenta…</p>;

  if (notFound) {
    return (
      <div className="space-y-4">
        <Link href="/ventas/mesas-por-cobrar" className="text-xs text-[#0EA5E9] hover:underline">← Mesas por cobrar</Link>
        <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-slate-400">
          La cuenta no existe o ya no está disponible.
        </div>
      </div>
    );
  }

  if (yaFacturada) {
    return (
      <div className="space-y-4">
        <Link href="/ventas/mesas-por-cobrar" className="text-xs text-[#0EA5E9] hover:underline">← Mesas por cobrar</Link>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="text-sm font-semibold text-emerald-800">
            Mesa {mesaNumero ?? ""} ya fue facturada.
          </p>
          {detalle?.sesion?.venta_id && (
            <a
              href={`/api/ventas/${detalle.sesion.venta_id}/ticket?copia=cliente&auto=1`}
              target="_blank" rel="noopener"
              className="mt-3 inline-block rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Imprimir ticket
            </a>
          )}
        </div>
      </div>
    );
  }

  const excludeIds = items.flatMap((it) => Array<string>(it.cantidad).fill(it.producto_id));

  return (
    <div className="space-y-8">
      <div>
        <Link href="/ventas/mesas-por-cobrar" className="text-xs text-[#0EA5E9] hover:underline">← Mesas por cobrar</Link>
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-gray-800">
          Facturar Mesa {mesaNumero ?? ""}
        </h1>
        <p className="text-gray-600">
          {detalle?.sesion?.mozo_id ? "" : ""}
          Ajustá la cuenta con el mismo buscador de Caja y cobrá. Al confirmar se registra la venta en la caja abierta.
        </p>
      </div>

      {/* La caja se abre acá mismo. Mandar al cajero a otra pantalla con el
          cliente esperando —y hacerle volver a buscar la mesa— era el paso más
          absurdo del recorrido: abrir caja es escribir un número. */}
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

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <span className="text-base leading-none mt-0.5"><AlertTriangle className="inline h-4 w-4 align-[-0.125em]" aria-hidden /></span><span className="font-medium">{error}</span>
        </div>
      )}

      {/* ── SECCIÓN 1: Agregar producto ─────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
        <SectionTitle>Agregar producto</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0EA5E9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0284C7] transition-colors shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
            </svg>
            Buscar producto
          </button>
          <button
            type="button"
            onClick={() => setMitadOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
          >
            <Pizza className="inline h-4 w-4 align-[-0.125em]" aria-hidden /> Pizza mitad y mitad
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">El mismo buscador del catálogo que usa Nueva venta (nombre, SKU, código, categoría).</p>
      </div>

      {/* ── SECCIÓN 2: Carrito + totales + cobro ────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
        <SectionTitle>Productos en esta cuenta</SectionTitle>

        {/* Lo que se agrega acá no sale a cocina solo: sale cuando alguien lo
            manda. Un producto que se está corrigiendo no puede aparecer en la
            parrilla por haberlo tipeado. */}
        {pendientes > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-xs text-amber-800">
              <strong>{pendientes} producto(s)</strong> sin enviar a cocina.
            </p>
            <button
              type="button"
              disabled={comandando}
              onClick={() => void onEnviarACocina()}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
            >
              {comandando ? "Enviando…" : "Enviar a cocina"}
            </button>
          </div>
        )}
        {okComanda && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800">
            {okComanda}
          </div>
        )}

        {items.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
            La cuenta quedó sin productos. Agregá al menos uno para facturar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] sm:min-w-0 text-sm text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-sm font-semibold">
                  <th className="py-2.5 pr-3 font-medium">Producto</th>
                  <th className="hidden py-2.5 pr-3 font-medium lg:table-cell">SKU</th>
                  <th className="py-2.5 pr-3 font-medium text-right">Precio unit.</th>
                  <th className="py-2.5 pr-3 font-medium text-center">Cant.</th>
                  <th className="py-2.5 pr-3 font-medium text-right">Total</th>
                  <th className="py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-200 last:border-0">
                    <td className="py-3 pr-3 font-medium text-gray-800">
                      {it.producto_nombre}
                      {it.es_mitad_mitad && it.mitad_1_nombre && it.mitad_2_nombre && (
                        <span className="block text-xs font-normal text-amber-700">½ {it.mitad_1_nombre} + ½ {it.mitad_2_nombre}</span>
                      )}
                      {it.observacion ? <span className="block text-xs font-normal text-slate-400">{it.observacion}</span> : null}
                    </td>
                    <td className="hidden py-3 pr-3 font-mono text-xs text-gray-500 lg:table-cell">{it.sku}</td>
                    <td className="py-3 pr-3 text-right tabular-nums text-gray-600 text-xs">{formatGs(it.precio_unitario)}</td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => changeQty(it.id, it.cantidad - 1)} className="h-8 w-8 rounded border border-slate-300 text-sm font-bold hover:bg-slate-50">−</button>
                        <span className="w-8 text-center text-sm tabular-nums">{it.cantidad}</span>
                        <button onClick={() => changeQty(it.id, it.cantidad + 1)} className="h-8 w-8 rounded border border-slate-300 text-sm font-bold hover:bg-slate-50">+</button>
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums font-semibold text-gray-800">{formatGs(it.total)}</td>
                    <td className="py-3 text-center">
                      <button
                        onClick={() => removeItem(it.id)}
                        title="Quitar producto"
                        className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] text-red-400 hover:text-red-700 transition-colors rounded hover:bg-red-50"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totales + Cobro */}
        <div className="mt-5 flex justify-end">
          <div className="w-full space-y-3 lg:w-96">
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span><span className="tabular-nums font-medium">{formatGs(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-600">
                <span>IVA</span><span className="tabular-nums font-medium">{ivaTotal > 0 ? formatGs(ivaTotal) : "—"}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200">
                <span>TOTAL</span><span className="tabular-nums">{formatGs(total)}</span>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Cobro</p>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Método de pago</label>
                <CobroRepartido
                  lineas={lineasCobro}
                  onChange={(l) => { setLineasCobro(l); setPago({}); }}
                  total={total}
                  inputClass={inputClass}
                />
              </div>

              {lineasCobro.some((l) => l.metodo === "efectivo") && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    {lineasCobro.length > 1 ? "Efectivo recibido (Gs.)" : "Monto recibido (Gs.)"}
                  </label>
                  <MontoInput value={montoRecibido} onChange={(n) => setMontoRecibido(String(n))} placeholder="Ej: 100.000" className={inputClass} decimals={false} />
                  {montoRecibidoNum > 0 && (
                    <div className="flex justify-between text-sm pt-2">
                      {vuelto >= 0 ? (
                        <><span className="text-gray-600">Vuelto</span><span className="font-bold text-emerald-600 tabular-nums">{formatGs(vuelto)}</span></>
                      ) : (
                        <><span className="text-gray-600">Falta</span><span className="font-bold text-red-600 tabular-nums">{formatGs(Math.abs(vuelto))}</span></>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-gray-400">Cálculo solo informativo — no se guarda en la venta.</p>
                </div>
              )}

              {/* Transferencia → cuenta destino + titular + N° de comprobante. */}
              {(metodo === "transferencia" || metodo === "qr") && (
                <div className="space-y-2">
                  {cuentas.length > 0 ? (
                    <SelectField value={pago.cuenta_bancaria_id ?? ""} onChange={(e) => setPago((p) => ({ ...p, cuenta_bancaria_id: e.target.value || null }))} className={inputClass}>
                      <option value="">Cuenta destino…</option>
                      {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.banco ? ` (${c.banco})` : ""}</option>)}
                    </SelectField>
                  ) : (
                    <p className="text-[11px] text-amber-600">No hay cuentas configuradas; se registra sin cuenta.</p>
                  )}
                  <input value={pago.entidad ?? ""} onChange={(e) => setPago((p) => ({ ...p, entidad: e.target.value }))} placeholder="Titular de la transferencia" className={inputClass} />
                  <input value={pago.referencia ?? ""} onChange={(e) => setPago((p) => ({ ...p, referencia: e.target.value }))} placeholder="N° de comprobante" className={inputClass} />
                </div>
              )}
              {/* Tarjeta → cuenta/banco + N° de operación. */}
              {metodo === "tarjeta" && (
                <div className="space-y-2">
                  {cuentas.length > 0 && (
                    <SelectField value={pago.cuenta_bancaria_id ?? ""} onChange={(e) => setPago((p) => ({ ...p, cuenta_bancaria_id: e.target.value || null }))} className={inputClass}>
                      <option value="">POS / banco…</option>
                      {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.tipo ? ` (${c.tipo})` : ""}</option>)}
                    </SelectField>
                  )}
                  <input value={pago.referencia ?? ""} onChange={(e) => setPago((p) => ({ ...p, referencia: e.target.value }))} placeholder="N° de operación" className={inputClass} />
                </div>
              )}
              {(metodo === "tarjeta" || metodo === "transferencia" || metodo === "qr") && (
                <p className="text-[11px] text-slate-400">Queda como conciliación <strong>pendiente</strong>. No suma al efectivo esperado.</p>
              )}
            </div>
          </div>
        </div>

        {/* Comprobante: se decide antes de cobrar, no después */}
        <div className="mt-6 border-t border-slate-100 pt-5">
          <SectionTitle>Comprobante</SectionTitle>
          <SelectorComprobante
            valor={comprobante}
            onChange={setComprobante}
            receptor={receptor}
            onReceptorChange={setReceptor}
          />
        </div>

        {/* Acciones */}
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push("/ventas/mesas-por-cobrar")}
            className="border border-slate-200 px-6 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors min-h-[48px] w-full sm:w-auto"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={facturar}
            disabled={busy || items.length === 0 || sinCaja || !comprobanteListo(comprobante, receptor)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 min-h-[48px] w-full sm:w-auto"
          >
            {busy ? "Facturando…" : comprobante === "factura" ? "Cobrar y facturar" : "Confirmar venta"}
          </button>
        </div>
      </div>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAgregar={handleAgregarDesdePicker}
        excludeIds={excludeIds}
        moneda="GS"
        tipoCambio={1}
        ivaDefault="10%"
      />

      <MitadMitadPicker open={mitadOpen} onClose={() => setMitadOpen(false)} onConfirm={handleAgregarMitad} />
    </div>
  );
}
