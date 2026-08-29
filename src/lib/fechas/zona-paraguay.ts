/**
 * El día, para el local, es el día en Paraguay.
 *
 * La base guarda las fechas como `timestamptz` y la sesión de Postgres corre en
 * UTC. Extraer el día con `to_char(fecha, 'YYYY-MM-DD')` devuelve entonces el
 * día UTC, que a partir de las 20:00 de Paraguay ya es el día siguiente. En una
 * lomitería eso es justo la hora pico: la cena entera se contaba como del día
 * de mañana.
 *
 * Se usa el nombre de la zona y no un desplazamiento fijo (-3 / -4) porque
 * Paraguay cambia de hora: en agosto está en UTC-4 y en verano en UTC-3.
 * Postgres resuelve cuál corresponde a cada fecha; un número fijo, no.
 */
export const TZ_PARAGUAY = "America/Asuncion";

/** Día calendario paraguayo de una columna `timestamptz`, como 'YYYY-MM-DD'. */
export function sqlDiaLocal(columna: string): string {
  return `to_char(${columna} AT TIME ZONE '${TZ_PARAGUAY}', 'YYYY-MM-DD')`;
}

/**
 * Desde qué instante empieza un día paraguayo dado como 'YYYY-MM-DD'.
 * `$n::date AT TIME ZONE '...'` es la medianoche local, no la UTC.
 */
export function sqlDesdeDiaLocal(columna: string, placeholder: string): string {
  return `${columna} >= (${placeholder}::date AT TIME ZONE '${TZ_PARAGUAY}')`;
}

/** Hasta el final del día paraguayo indicado, inclusive. */
export function sqlHastaDiaLocal(columna: string, placeholder: string): string {
  return `${columna} < ((${placeholder}::date + interval '1 day') AT TIME ZONE '${TZ_PARAGUAY}')`;
}
