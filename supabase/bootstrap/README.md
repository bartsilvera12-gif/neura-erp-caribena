# Bootstrap — Neura ERP Caribeña

Puesta en marcha de la instancia dedicada **Caribeña** sobre el mismo proyecto
Supabase que ya usa En lo de Mari, con schema propio `caribenaerp` y su propio
`empresa_id`. No se copian datos: sólo la estructura.

## Orden

Correr en el **SQL Editor de Supabase**, uno por vez, en este orden:

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `01_clone_schema_estructura.sql` | Crea el schema `caribenaerp` y clona de `enlodemari` tipos, secuencias, funciones, tablas, constraints, índices, FKs, vistas, triggers, RLS y policies. Sin datos. |
| 2 | `02_grants.sql` | Grants a `anon`, `authenticated`, `service_role` + default privileges para objetos futuros. |
| 3 | `03_empresa_caribena.sql` | Inserta la empresa Caribeña con un UUID nuevo y le replica los módulos habilitados. Imprime el `empresa_id`. |

Cada script corre dentro de una transacción: si algo falla, no queda nada a medias.
Al final de 1 y 2 hay una query de verificación — los conteos entre `enlodemari` y
`caribenaerp` deben coincidir.

## Después de correr los scripts

1. **Exponer el schema**: Supabase → *Settings → API → Exposed schemas* → agregar
   `caribenaerp`. Sin esto PostgREST no lo ve, por más grants que haya.
2. **Variables de entorno** (Vercel y `.env.local`):

   ```
   NEURA_CLIENT_SCHEMA=caribenaerp
   NEURA_INSTANCE_MODE=single_client
   NEXT_PUBLIC_SUPABASE_URL=...        # mismo proyecto Supabase
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   DATABASE_URL=...
   DIRECT_URL=...
   ```

   `NEURA_CLIENT_SCHEMA` es sólo un override: el default del repo ya es
   `caribenaerp` (ver `src/lib/supabase/schema.ts`).
3. **Usuario inicial**: crearlo en Supabase Auth y darle su fila en
   `caribenaerp.usuarios` con el `empresa_id` que imprimió el paso 3.

## Rehacer desde cero

```sql
DROP SCHEMA caribenaerp CASCADE;
```

y volver a correr los tres scripts.

## Límites conocidos

- Las **tablas particionadas** se recrean como tabla plana (hoy no hay ninguna en
  `enlodemari`; el script avisa por `NOTICE` si aparece alguna).
- Las **FKs hacia otros schemas** (`public`, `zentra_erp`, `auth`) se conservan
  apuntando a su schema original — es lo correcto para tablas compartidas, pero
  conviene revisarlas si esperabas aislamiento total.
- Las opciones de secuencia de columnas `IDENTITY` (start/increment custom) no se
  copian; arrancan con los valores por defecto. Como el schema queda vacío, no
  afecta.
- Los **datos de catálogo** (módulos, roles, estados, menú) no se copian, salvo
  `empresa_modulos` en el paso 3. Si querés arrastrar catálogos, corré las
  migraciones de seed de `supabase/caribenaerp/migrations/`.
