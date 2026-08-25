-- =============================================================================
-- Neura ERP — Caribeña
-- PASO 4/4: crear la empresa propia de esta instancia (id nuevo, independiente
--           del de En lo de Mari) y habilitarle los mismos módulos.
--
-- Correr DESPUÉS de 01_clone_schema_estructura.sql, 02_aislar.sql y 03_grants.sql.
--
-- El script es defensivo: mira qué columnas existen realmente en
-- `caribenaerp.empresas` y sólo completa las que encuentra. Acepta varias
-- convenciones de nombre (`nombre`, `nombre_empresa`, `razon_social`, …).
-- Si queda alguna columna NOT NULL sin default que no sabe llenar, aborta y te
-- vuelca la estructura completa de la tabla, en vez de crear la empresa a medias.
--
-- Al terminar imprime el UUID de la empresa nueva: ese es el `empresa_id` de
-- Caribeña.
-- =============================================================================

BEGIN;

DO $seed$
DECLARE
  dst        text   := 'caribenaerp';
  nombre_emp text   := 'Caribeña';        -- ← ajustá el nombre comercial
  ruc_emp    text   := NULL;              -- ← ajustá el RUC si lo tenés
  nueva_id   uuid   := gen_random_uuid();
  col_names  text[] := '{}';
  col_vals   text[] := '{}';
  faltantes  text;
  todas      text;
  c          text;
  n          int;
  rel        regclass;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class cl JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = dst AND cl.relname = 'empresas' AND cl.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'No existe %.empresas. ¿El PASO 1 corrió bien?', dst;
  END IF;

  rel := (dst || '.empresas')::regclass;

  -- ── id ─────────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = rel AND a.attname = 'id'
               AND a.attnum > 0 AND NOT a.attisdropped) THEN
    col_names := col_names || 'id'::text;
    col_vals  := col_vals  || (quote_literal(nueva_id::text) || '::uuid');
  END IF;

  -- ── nombre comercial (varias convenciones posibles) ────────────────────────
  FOREACH c IN ARRAY ARRAY['nombre','nombre_empresa','razon_social','nombre_comercial'] LOOP
    IF EXISTS (SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = rel AND a.attname = c
                 AND a.attnum > 0 AND NOT a.attisdropped)
       AND NOT (c = ANY (col_names)) THEN
      col_names := col_names || c;
      col_vals  := col_vals  || quote_literal(nombre_emp);
    END IF;
  END LOOP;

  -- ── RUC ────────────────────────────────────────────────────────────────────
  IF ruc_emp IS NOT NULL THEN
    FOREACH c IN ARRAY ARRAY['ruc','ruc_empresa','documento'] LOOP
      IF EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = rel AND a.attname = c
                   AND a.attnum > 0 AND NOT a.attisdropped)
         AND NOT (c = ANY (col_names)) THEN
        col_names := col_names || c;
        col_vals  := col_vals  || quote_literal(ruc_emp);
      END IF;
    END LOOP;
  END IF;

  -- ── activo ─────────────────────────────────────────────────────────────────
  FOREACH c IN ARRAY ARRAY['activo','activa'] LOOP
    IF EXISTS (SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = rel AND a.attname = c
                 AND a.attnum > 0 AND NOT a.attisdropped)
       AND NOT (c = ANY (col_names)) THEN
      col_names := col_names || c;
      col_vals  := col_vals  || 'true'::text;
    END IF;
  END LOOP;

  -- ── data_schema: en instancia dedicada apunta al schema propio ─────────────
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = rel AND a.attname = 'data_schema'
               AND a.attnum > 0 AND NOT a.attisdropped) THEN
    col_names := col_names || 'data_schema'::text;
    col_vals  := col_vals  || quote_literal(dst);
  END IF;

  -- ── ¿Queda alguna columna obligatoria que no sepamos llenar? ───────────────
  SELECT string_agg(a.attname || ' (' || format_type(a.atttypid, a.atttypmod) || ')',
                    ', ' ORDER BY a.attnum)
    INTO faltantes
  FROM pg_attribute a
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = rel
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attnotnull AND ad.adbin IS NULL
    AND a.attidentity = '' AND a.attgenerated = ''
    AND NOT (a.attname::text = ANY (col_names));

  IF faltantes IS NOT NULL THEN
    -- Volcar la estructura completa para poder resolverlo de una sola vez.
    SELECT string_agg(
             a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
             || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
             || CASE WHEN ad.adbin IS NOT NULL
                     THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid) ELSE '' END,
             E'\n    ' ORDER BY a.attnum)
      INTO todas
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE a.attrelid = rel AND a.attnum > 0 AND NOT a.attisdropped;

    RAISE EXCEPTION E'Faltan columnas obligatorias en %.empresas: %\n\n  Estructura completa de la tabla:\n    %\n\n  Agregá esos valores en el bloque de arriba y volvé a correr.',
      dst, faltantes, todas;
  END IF;

  EXECUTE format('INSERT INTO %I.empresas (%s) VALUES (%s)',
                 dst,
                 (SELECT string_agg(quote_ident(x), ', ') FROM unnest(col_names) AS u(x)),
                 array_to_string(col_vals, ', '));

  RAISE NOTICE '────────────────────────────────────────────────────────';
  RAISE NOTICE 'Empresa "%" creada.', nombre_emp;
  RAISE NOTICE 'EMPRESA_ID = %', nueva_id;
  RAISE NOTICE '────────────────────────────────────────────────────────';

  -- ── Módulos habilitados ────────────────────────────────────────────────────
  -- Se replica el allowlist de En lo de Mari, apuntado a la empresa nueva.
  -- Se copian todas las columnas comunes menos id/empresa_id. Es una lectura
  -- puntual del bootstrap: no deja ninguna dependencia permanente.
  IF EXISTS (SELECT 1 FROM pg_class cl JOIN pg_namespace ns ON ns.oid = cl.relnamespace
             WHERE ns.nspname = dst AND cl.relname = 'empresa_modulos' AND cl.relkind = 'r')
     AND EXISTS (SELECT 1 FROM pg_class cl JOIN pg_namespace ns ON ns.oid = cl.relnamespace
             WHERE ns.nspname = 'enlodemari' AND cl.relname = 'empresa_modulos' AND cl.relkind = 'r') THEN

    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
      INTO faltantes
    FROM pg_attribute a
    WHERE a.attrelid = (dst || '.empresa_modulos')::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id', 'empresa_id')
      AND EXISTS (SELECT 1 FROM pg_attribute b
                  WHERE b.attrelid = 'enlodemari.empresa_modulos'::regclass
                    AND b.attname = a.attname AND b.attnum > 0 AND NOT b.attisdropped);

    IF faltantes IS NOT NULL THEN
      EXECUTE format(
        'INSERT INTO %I.empresa_modulos (empresa_id, %s) SELECT %L::uuid, %s FROM enlodemari.empresa_modulos',
        dst, faltantes, nueva_id, faltantes);
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE '% filas de empresa_modulos replicadas desde enlodemari.', n;
    END IF;
  END IF;

  RAISE NOTICE 'PASO 4 listo.';
END
$seed$;

COMMIT;

-- ── El empresa_id de Caribeña ────────────────────────────────────────────────
SELECT * FROM caribenaerp.empresas;


-- =============================================================================
-- Si el script aborta pidiendo columnas que no sabe llenar, esta query te
-- muestra la estructura de la tabla para completar el bloque de arriba:
--
--   SELECT a.attnum, a.attname,
--          format_type(a.atttypid, a.atttypmod) AS tipo,
--          a.attnotnull                          AS obligatoria,
--          pg_get_expr(ad.adbin, ad.adrelid)     AS valor_por_defecto
--   FROM pg_attribute a
--   LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
--   WHERE a.attrelid = 'caribenaerp.empresas'::regclass
--     AND a.attnum > 0 AND NOT a.attisdropped
--   ORDER BY a.attnum;
-- =============================================================================
