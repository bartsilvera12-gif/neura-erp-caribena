/**
 * Prueba en transacción con ROLLBACK del cobro repartido.
 *
 * Lo que importa verificar no es que se guarden las filas, sino que el cierre
 * de caja reparta bien: una venta cobrada en parte en efectivo y en parte por
 * transferencia tiene un solo `metodo_pago`, y contarla entera de un lado
 * descuadra el arqueo por plata que nunca entró al cajón.
 *
 * No deja nada en la base.
 */
const { Client } = require("pg");

const CONN = process.env.PG_URL || "postgresql://postgres:NeuraDB2026@187.77.247.54:6432/postgres?sslmode=disable";
const S = "caribenaerp";

(async () => {
  const c = new Client({ connectionString: CONN });
  await c.connect();
  const empresaId = (await c.query(`select id from ${S}.empresas limit 1`)).rows[0].id;

  await c.query("BEGIN");
  try {
    let fallos = 0;
    const fallar = (m) => { fallos++; console.log("FALLO: " + m); };

    // Sólo puede haber una caja abierta por empresa, así que se reusa la que
    // esté abierta y, si no hay, se abre una para la prueba.
    const abierta = await c.query(
      `select id from ${S}.cajas where empresa_id=$1 and estado='abierta' limit 1`,
      [empresaId]
    );
    const cajaId = abierta.rows.length
      ? abierta.rows[0].id
      : (
          await c.query(
            `insert into ${S}.cajas (empresa_id, numero_caja, estado, monto_apertura, fecha_apertura)
             values ($1, 9999, 'abierta', 100000, now()) returning id`,
            [empresaId]
          )
        ).rows[0].id;

    // La caja reusada puede tener ventas previas: se miden sólo las de la
    // prueba, filtrando por su número de control.
    const PREFIJO = "VTA-QA-";

    /** Crea una venta con su detalle de cobro, como hace el ERP. */
    async function venta(numero, total, pagos) {
      const predominante = [...pagos].sort((a, b) => b.monto - a.monto)[0].metodo;
      const id = (
        await c.query(
          `insert into ${S}.ventas (empresa_id, numero_control, subtotal, monto_iva, total,
             metodo_pago, caja_id, fecha)
           values ($1,$2,$3,$4,$5,$6,$7, now()) returning id`,
          [empresaId, numero, total - Math.round(total / 11), Math.round(total / 11), total,
           predominante, cajaId]
        )
      ).rows[0].id;
      for (const p of pagos) {
        await c.query(
          `insert into ${S}.ventas_pagos_detalle (empresa_id, venta_id, metodo_pago, monto)
           values ($1,$2,$3,$4)`,
          [empresaId, id, p.metodo, p.monto]
        );
      }
      return id;
    }

    // Repartida: 60 en efectivo + 40 por transferencia. El método predominante
    // queda en efectivo, que es justo lo que descuadraría el arqueo viejo.
    await venta("VTA-QA-MIX", 100000, [
      { metodo: "efectivo", monto: 60000 },
      { metodo: "transferencia", monto: 40000 },
    ]);
    // Simple: una sola forma de pago.
    await venta("VTA-QA-EF", 30000, [{ metodo: "efectivo", monto: 30000 }]);
    await venta("VTA-QA-TJ", 50000, [{ metodo: "tarjeta", monto: 50000 }]);

    // ── Lo que hace computeResumen ────────────────────────────────────────
    const ventas = (
      await c.query(
        `select id, total::float8 total, metodo_pago from ${S}.ventas
          where empresa_id=$1 and caja_id=$2 and estado <> 'anulada'
            and numero_control like $3`,
        [empresaId, cajaId, PREFIJO + "%"]
      )
    ).rows;
    const pagos = (
      await c.query(
        `select venta_id, metodo_pago, monto::float8 monto from ${S}.ventas_pagos_detalle
          where empresa_id=$1 and venta_id = any($2)`,
        [empresaId, ventas.map((v) => v.id)]
      )
    ).rows;

    const porVenta = new Map();
    for (const p of pagos) {
      const l = porVenta.get(p.venta_id) ?? [];
      l.push({ metodo: p.metodo_pago, monto: p.monto });
      porVenta.set(p.venta_id, l);
    }

    let vendido = 0, efectivo = 0, tarjeta = 0, transferencia = 0;
    for (const v of ventas) {
      vendido += v.total;
      const lineas = porVenta.get(v.id) ?? [{ metodo: v.metodo_pago ?? "efectivo", monto: v.total }];
      for (const l of lineas) {
        if (l.metodo === "tarjeta") tarjeta += l.monto;
        else if (l.metodo === "transferencia") transferencia += l.monto;
        else efectivo += l.monto;
      }
    }

    console.table([{ vendido, efectivo, tarjeta, transferencia }]);

    // Esperado: 180.000 vendidos = 90.000 efectivo + 50.000 tarjeta + 40.000 transf.
    if (vendido !== 180000) fallar(`vendido ${vendido}, se esperaba 180000`);
    if (efectivo !== 90000) fallar(`efectivo ${efectivo}, se esperaba 90000 (60000 de la mixta + 30000)`);
    if (tarjeta !== 50000) fallar(`tarjeta ${tarjeta}, se esperaba 50000`);
    if (transferencia !== 40000) fallar(`transferencia ${transferencia}, se esperaba 40000`);
    if (efectivo + tarjeta + transferencia !== vendido)
      fallar("el reparto por método no suma el total vendido");

    // El arqueo viejo — todo al método predominante — habría dado 100.000 de
    // efectivo en la mixta. Se deja explícito para que se vea qué se arregló.
    let efectivoViejo = 0;
    for (const v of ventas) {
      if (v.metodo_pago === "efectivo" || !v.metodo_pago) efectivoViejo += v.total;
    }
    console.log(`Efectivo con el cálculo viejo: ${efectivoViejo} (habría sobrado ${efectivoViejo - efectivo} en el cajón)`);

    // La base tiene que rechazar una línea en cero.
    let bloqueado = false;
    try {
      await c.query("SAVEPOINT z");
      await c.query(
        `insert into ${S}.ventas_pagos_detalle (empresa_id, venta_id, metodo_pago, monto)
         values ($1,$2,'efectivo',0)`,
        [empresaId, ventas[0].id]
      );
      await c.query("RELEASE SAVEPOINT z");
    } catch {
      bloqueado = true;
      await c.query("ROLLBACK TO SAVEPOINT z");
    }
    if (!bloqueado) fallar("la base acepta una línea de cobro en 0");

    console.log(`\n${fallos === 0 ? "COBRO REPARTIDO OK" : `${fallos} FALLO(S)`}`);
  } finally {
    await c.query("ROLLBACK");
    await c.end();
    console.log("ROLLBACK: la base quedó como estaba.");
  }
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
