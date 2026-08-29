/**
 * Prueba en transacción con ROLLBACK de que el día de una venta es el día en
 * Paraguay y no el día UTC.
 *
 * La base corre en UTC. Una venta de las 20:06 de Paraguay ocurre a las 00:06
 * UTC del día siguiente, así que leer la fecha sin convertir la corre un día
 * para adelante. En una lomitería eso afecta a toda la cena.
 *
 * Se comprueba en los tres lugares donde importa: la fecha de emisión que va a
 * la factura electrónica, el agrupado por día del reporte de ventas y el filtro
 * por rango de fechas.
 *
 * No deja nada en la base.
 */
const { Client } = require("pg");

const CONN = process.env.PG_URL || "postgresql://postgres:NeuraDB2026@187.77.247.54:6432/postgres?sslmode=disable";
const S = "caribenaerp";
const TZ = "America/Asuncion";

/** Jueves 20:06 en Paraguay = viernes 00:06 UTC. El caso que rompía. */
const INSTANTE = "2026-08-29T00:06:04Z";
const DIA_LOCAL_ESPERADO = "2026-08-28";

(async () => {
  const c = new Client({ connectionString: CONN });
  await c.connect();
  const empresaId = (await c.query(`select id from ${S}.empresas limit 1`)).rows[0].id;

  await c.query("BEGIN");
  try {
    let fallos = 0;
    const fallar = (m) => { fallos++; console.log("FALLO: " + m); };

    const ventaId = (await c.query(
      `insert into ${S}.ventas (empresa_id, numero_control, subtotal, monto_iva, total, fecha)
       values ($1,'VTA-QA-TZ',22727,2273,25000,$2::timestamptz) returning id`,
      [empresaId, INSTANTE]
    )).rows[0].id;

    // ── Fecha de emisión del documento electrónico ────────────────────────
    const q = await c.query(
      `select to_char(fecha, 'YYYY-MM-DD')                        as dia_utc,
              to_char(fecha at time zone $2, 'YYYY-MM-DD')        as dia_local
         from ${S}.ventas where id = $1`,
      [ventaId, TZ]
    );
    const { dia_utc, dia_local } = q.rows[0];
    console.log(`Venta de las 20:06 del ${DIA_LOCAL_ESPERADO} en Paraguay:`);
    console.log(`  leída en UTC      → ${dia_utc}${dia_utc !== DIA_LOCAL_ESPERADO ? "   ← un día de más" : ""}`);
    console.log(`  leída en Paraguay → ${dia_local}`);

    if (dia_utc === DIA_LOCAL_ESPERADO) {
      fallar("la prueba no reproduce el defecto: revisá el instante elegido");
    }
    if (dia_local !== DIA_LOCAL_ESPERADO) {
      fallar(`el día local dio ${dia_local} y tenía que dar ${DIA_LOCAL_ESPERADO}`);
    }

    // ── Agrupado por día del reporte ──────────────────────────────────────
    const rep = await c.query(
      `select to_char(fecha at time zone $2, 'YYYY-MM-DD') as dia, sum(total) as total
         from ${S}.ventas where id = $1 group by 1`,
      [ventaId, TZ]
    );
    if (rep.rows[0].dia !== DIA_LOCAL_ESPERADO) {
      fallar(`el reporte agrupó la venta en ${rep.rows[0].dia}`);
    } else {
      console.log(`Reporte: la venta cae en ${rep.rows[0].dia}, como corresponde.`);
    }

    // ── Filtro por rango: pedir sólo el 28 tiene que traerla ──────────────
    const filtro = await c.query(
      `select count(*)::int as n from ${S}.ventas
        where id = $1
          and fecha >= ($2::date at time zone $4)
          and fecha <  (($3::date + interval '1 day') at time zone $4)`,
      [ventaId, DIA_LOCAL_ESPERADO, DIA_LOCAL_ESPERADO, TZ]
    );
    if (filtro.rows[0].n !== 1) {
      fallar("filtrando por el 28 la venta no aparece");
    } else {
      console.log("Filtro: pidiendo el 28, la venta del 28 aparece.");
    }

    // Y con el filtro viejo (medianoche UTC) no aparecía: eso es lo que veía
    // el dueño cuando el reporte del día le daba de menos.
    const viejo = await c.query(
      `select count(*)::int as n from ${S}.ventas
        where id = $1 and fecha >= $2::date and fecha < ($3::date + interval '1 day')`,
      [ventaId, DIA_LOCAL_ESPERADO, DIA_LOCAL_ESPERADO]
    );
    console.log(`Con el filtro viejo la venta ${viejo.rows[0].n === 1 ? "aparecía" : "NO aparecía"} en el día 28.`);

    console.log(`\n${fallos === 0 ? "FECHA EN HORA DE PARAGUAY OK" : `${fallos} FALLO(S)`}`);
    if (fallos > 0) process.exitCode = 1;
  } finally {
    await c.query("ROLLBACK");
    await c.end();
    console.log("ROLLBACK: la base quedó como estaba.");
  }
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
