const { Client } = require("pg");
const CONN = "postgresql://postgres:NeuraDB2026@187.77.247.54:6432/postgres?sslmode=disable";
(async () => {
  const c = new Client({ connectionString: CONN });
  await c.connect();
  const e = await c.query(`
    select f.numero_factura, e.destinatario, e.origen, e.ok, e.error,
           to_char(e.created_at at time zone interval '-03:00','YYYY-MM-DD HH24:MI') as cuando
      from caribenaerp.factura_email_envios e
      join caribenaerp.facturas f on f.id = e.factura_id
     order by e.created_at desc limit 10`);
  console.log(`intentos registrados: ${e.rowCount}`);
  if (e.rowCount) console.table(e.rows);
  await c.end();
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
