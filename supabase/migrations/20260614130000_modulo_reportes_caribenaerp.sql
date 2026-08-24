-- =============================================================================
-- Alta del módulo "Reportes" en el catálogo — SOLO schema `caribenaerp`.
--
-- Instancia MONOCLIENTE: el catálogo de módulos (modulos / empresa_modulos) vive
-- DENTRO del schema caribenaerp, no en public/zentra_erp. `NEURA_INSTANCE_MODE=
-- single_client` activa strictAllowlist → un slug solo es visible si está activo
-- en empresa_modulos. El módulo `reportes` no existía, por eso no se veía en el
-- sidebar pese a tener la ruta /reportes.
--
-- Idempotente. NO toca otros schemas ni otros clientes. No otorga otros módulos.
-- =============================================================================

INSERT INTO caribenaerp.modulos (nombre, slug, descripcion)
SELECT 'Reportes', 'reportes', 'Reportes de cierres de caja y estado de cuenta'
WHERE NOT EXISTS (SELECT 1 FROM caribenaerp.modulos WHERE slug = 'reportes');

INSERT INTO caribenaerp.empresa_modulos (empresa_id, modulo_id, activo)
SELECT e.id, m.id, true
FROM caribenaerp.empresas e
CROSS JOIN caribenaerp.modulos m
WHERE m.slug = 'reportes'
  AND NOT EXISTS (
    SELECT 1 FROM caribenaerp.empresa_modulos em
    WHERE em.empresa_id = e.id AND em.modulo_id = m.id
  );
