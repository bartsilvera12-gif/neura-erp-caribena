/**
 * Factura "Sin Nombre" (receptor innominado SIFEN).
 *
 * Para la venta de mostrador en la que el cliente no da sus datos pero igual
 * hay que facturar. La SET lo admite como receptor innominado en operación B2C:
 * iNatRec=2 (no contribuyente), iTiOpe=2 (B2C), iTipIDRec=5 (Innominado),
 * dNomRec="Sin Nombre", dNumIDRec="0".
 *
 * Este módulo lo comparten la caja (navegador) y el servidor para que los dos
 * usen el mismo nombre y el mismo tope, y no haya forma de que una pantalla
 * deje pasar algo que el servidor rechazaría (o al revés).
 */

/** Valor exacto de dNomRec para el receptor innominado. */
export const NOMBRE_RECEPTOR_SIN_NOMBRE = "Sin Nombre";

/**
 * Tope de monto (Gs.) por encima del cual NO se permite emitir sin nombre y se
 * le pide el RUC al cliente. Es una barrera de seguridad del ERP, no un dato
 * fijo de la SET: la normativa de identificación del receptor puede cambiar, y
 * acá preferimos frenar antes de que la SET rechace una venta grande sin datos.
 *
 * Si tu contador indica otro número, se cambia sólo esta constante.
 */
export const TOPE_FACTURA_SIN_NOMBRE_GS = 7_000_000;

/** true si el total supera el tope y por lo tanto no puede ir sin nombre. */
export function superaTopeFacturaSinNombre(totalGs: number): boolean {
  const t = Number(totalGs);
  if (!Number.isFinite(t)) return false;
  return t > TOPE_FACTURA_SIN_NOMBRE_GS;
}

/** Aviso listo para mostrar cuando el total supera el tope. */
export function avisoTopeFacturaSinNombre(): string {
  return `Sin nombre sólo hasta Gs. ${TOPE_FACTURA_SIN_NOMBRE_GS.toLocaleString(
    "es-PY"
  )}. Por encima de eso, pedile el RUC al cliente y emití factura normal.`;
}
