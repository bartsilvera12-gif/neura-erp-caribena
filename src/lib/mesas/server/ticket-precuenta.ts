import { wrapTicketDocument } from "@/lib/printing/thermal-ticket";
import { etiquetaPorciones, porcionesDeNombre, saborCorto } from "@/lib/ventas/pizza-porciones";
import type { MesaDetalle } from "@/lib/mesas/types";

/**
 * Precuenta de una mesa/pedido para llevar.
 *
 * Es puramente informativa: se imprime cuando el cliente pide "la cuenta" antes
 * de elegir medio de pago. NO registra venta, pago, movimiento de caja, ni
 * cierra la sesión — sólo lee el estado actual y arma el papel.
 *
 * Reutiliza `wrapTicketDocument` (mismo layout térmico 58/80mm que el resto de
 * impresiones) y por ende funciona con la misma cadena ESC/POS del navegador.
 * Se diferencia visualmente del comprobante final con el banner "PRECUENTA" y
 * la leyenda "NO VÁLIDO COMO FACTURA" bien visible.
 */

const NEGOCIO = "CARIBEÑA";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatGs(v: number): string {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const shifted = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(shifted.getUTCDate())}/${p(shifted.getUTCMonth() + 1)}/${shifted.getUTCFullYear()} ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}`;
  } catch {
    return iso;
  }
}

function formatPL(n: number | null): string {
  return `PL-${String(n ?? 0).padStart(3, "0")}`;
}

export function buildPrecuentaDocument(detalle: MesaDetalle, widthMm: 58 | 80): string {
  const { mesa, sesion, items, total } = detalle;
  const esParaLlevar = sesion?.tipo === "para_llevar";

  const encabezado = esParaLlevar
    ? `<div><strong>PARA LLEVAR · ${escapeHtml(formatPL(sesion?.numero_pl ?? null))}</strong></div>${
        sesion?.nombre_cliente ? `<div>Cliente: ${escapeHtml(sesion.nombre_cliente)}</div>` : ""
      }`
    : `<div><strong>Mesa ${mesa.numero ?? "—"}</strong></div>`;

  // Vigentes: excluir cancelados (aunque getSesionDetallePg ya filtra a
  // ITEM_VIGENTES, dejamos la guarda por si cambia el filtro upstream).
  const vigentes = items.filter((it) => it.estado !== "cancelado");

  const itemsHtml = vigentes
    .map((it) => {
      const esMitad = it.es_mitad_mitad && it.mitad_1_nombre && it.mitad_2_nombre;
      const mitad = esMitad
        ? `<tr class="sub"><td></td><td colspan="2">½ ${escapeHtml(
            saborCorto(it.mitad_1_nombre)
          )} + ½ ${escapeHtml(saborCorto(it.mitad_2_nombre))}</td></tr>`
        : "";
      const obs = it.observacion
        ? `<tr class="sub"><td></td><td colspan="2">&gt;&gt; ${escapeHtml(it.observacion)}</td></tr>`
        : "";
      const nombre =
        esMitad && porcionesDeNombre(it.producto_nombre) == null
          ? `${it.producto_nombre} ${etiquetaPorciones(porcionesDeNombre(it.mitad_1_nombre))}`.trim()
          : it.producto_nombre;

      return `
        <tr>
          <td class="qty"><strong>${it.cantidad}×</strong></td>
          <td class="name">${escapeHtml(nombre)}</td>
          <td class="amt">${formatGs(it.total)}</td>
        </tr>
        <tr class="sub"><td></td><td colspan="2">${it.cantidad} × ${formatGs(it.precio_unitario)}</td></tr>${mitad}${obs}`;
    })
    .join("");

  const fecha = formatFecha(new Date().toISOString());

  const section = `<section class="paper last">
    <div class="sector-banner">PRECUENTA</div>
    <h1>${NEGOCIO}</h1>
    <div class="nota-pedido">NO VÁLIDO COMO FACTURA</div>
    <div class="meta">${escapeHtml(fecha)}</div>
    <hr>
    <div class="pedido">${encabezado}</div>
    <hr>
    <table><tbody>${
      itemsHtml || '<tr><td colspan="3">(sin productos)</td></tr>'
    }</tbody></table>
    <hr>
    <table class="totales"><tbody>
      <tr class="total-row"><td class="lbl">TOTAL</td><td class="val">${formatGs(total)}</td></tr>
    </tbody></table>
    <hr>
    <div class="footer">
      Documento informativo. No es comprobante fiscal.<br>
      La cuenta se cierra al registrar el pago.
    </div>
  </section>`;

  return wrapTicketDocument(section, {
    widthMm,
    title: `Precuenta — ${esParaLlevar ? formatPL(sesion?.numero_pl ?? null) : `Mesa ${mesa.numero ?? ""}`}`,
    autoPrint: true,
  });
}
