-- Factura "Sin Nombre" (receptor innominado) en el mostrador.
--
-- Muchos clientes no piden factura, pero el local igual debe facturar. La SET
-- lo permite con el receptor innominado (iNatRec=2, iTiOpe=2, iTipIDRec=5,
-- dNomRec="Sin Nombre") para ventas B2C al consumidor final.
--
-- Una factura sin cliente, sin RUC y sin documento es ambigua: podría ser un
-- consumidor final que todavía va a dar sus datos, o una innominada a
-- propósito. Esta columna lo marca de forma explícita para que el armado del
-- DE elija la rama innominada sin adivinar.

BEGIN;

ALTER TABLE caribenaerp.facturas
  ADD COLUMN IF NOT EXISTS receptor_sin_nombre boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN caribenaerp.facturas.receptor_sin_nombre IS
  'true = factura emitida a receptor innominado SIFEN ("Sin Nombre", B2C). El DE usa iNatRec=2, iTiOpe=2, iTipIDRec=5.';

COMMIT;

NOTIFY pgrst, 'reload schema';
