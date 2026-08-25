-- =============================================================================
-- Neura ERP — Caribeña
-- PASO 4/4: crear la empresa propia de esta instancia (id nuevo, independiente
--           del de En lo de Mari) y habilitarle los mismos módulos.
--
-- Correr DESPUÉS de 01_clone_schema_estructura.sql, 02_aislar.sql y 03_grants.sql.
--
-- El script es defensivo: mira qué columnas existen realmente en
-- `caribenaerp.empresas` y sólo completa las que encuentra. Si hay columnas
-- NOT NULL sin default que no sabe llenar, aborta y te las lista para que
-- las agregues a mano acá abajo, en vez de dejar la empresa a medio crear.
--
-- Al terminar imprime el UUID de la empresa nueva: ese es el `empresa_id` de
-- Caribeña.
-- =============================================================================

BEGIN;

DO $seed$
DECLARE
  dst          text := 'caribenaerp';
  nombre_emp   text := 'Caribeña';          -- ← ajustá el nombre comercial
  ruc_emp      text := NULL;                -- ← ajustá el RUC si lo tenés
  nueva_id     uuid := gen_random_uuid();
  col_names    text[] := '{}';
  col_vals     text[] := '{}';
  faltantes    text;
  n            int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = dst AND c.relname = 'empresas' AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'No existe %.empresas. ¿Corriste 01_clone_schema_estructura.sql?', dst;
  END IF;

  -- Columnas que sabemos llenar, si existen en la tabla.
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = (dst || '.empresas')::regclass
             AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped) THEN
    col_names := col_names || 'id';        col_vals := col_vals || quote_literal(nueva_id::text) || '::uuid';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = (dst || '.empresas')::regclass
             AND a.attname = 'nombre' AND a.attnum > 0 AND NOT a.attisdropped) THEN
    col_names := col_names || 'nombre';    col_vals := col_vals || quote_literal(nombre_emp);
  END IF;
  IF ruc_emp IS NOT NULL AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = (dst || '.empresas')::regclass
             AND a.attname = 'ruc' AND a.attnum > 0 AND NOT a.attisdropped) THEN
    col_names := col_names || 'ruc';       col_vals := col_vals || quote_literal(ruc_emp);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = (dst || '.empresas')::regclass
             AND a.attname = 'activo' AND a.attnum > 0 AND NOT a.attisdropped) THEN
    col_names := col_names || 'activo';    col_vals := col_vals || 'true';
  END IF;
  -- `data_schema`: en instancia dedicada apunta al schema propio.
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = (dst || '.empresas')::regclass
             AND a.attname = 'data_schema' AND a.attnum > 0 AND NOT a.attisdropped) THEN
    col_names := col_names || 'data_schema'; col_vals := col_vals || quote_literal(dst);
  END IF;

  -- ¿Queda alguna columna obligatoria que no sepamos llenar?
  SELECT string_agg(a.attname || ' (' || format_type(a.atttypid, a.atttypmod) || ')', ', ' ORDER BY a.attnum)
    INTO faltantes
  FROM pg_attribute a
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = (dst || '.empresas')::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attnotnull AND ad.adbin IS NULL
    AND a.attidentity = '' AND a.attgenerated = ''
    AND NOT (a.attname = ANY (col_names));

  IF faltantes IS NOT NULL THEN
    RAISE EXCEPTION
      'Faltan columnas obligatorias en %.empresas: %. Agregalas al bloque de arriba y volvé a correr.',
      dst, faltantes;
  END IF;

  EXECUTE format('INSERT INTO %I.empresas (%s) VALUES (%s)',
                 dst,
                 (SELECT string_agg(quote_ident(x), ', ') FROM unnest(col_names) AS u(x)),
                 array_to_string(col_vals, ', '));

  RAISE NOTICE '────────────────────────────────────────────────────────';
  RAISE NOTICE 'Empresa "%" creada.', nombre_emp;
  RAISE NOTICE 'EMPRESA_ID = %', nueva_id;
  RAISE NOTICE '────────────────────────────────────────────────────────';

  -- Módulos habilitados: se replica el allowlist de En lo de Mari, apuntado a
  -- la empresa nueva. Si tu tabla `empresa_modulos` tiene otras columnas, se
  -- copian todas menos `id` y `empresa_id`.
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = dst AND c.relname = 'empresa_modulos' AND c.relkind = 'r')
     AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'enlodemari' AND c.relname = 'empresa_modulos' AND c.relkind = 'r') THEN

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
END
$seed$;

COMMIT;

-- ── El empresa_id de Caribeña ────────────────────────────────────────────────
SELECT id AS empresa_id, * FROM caribenaerp.empresas;
