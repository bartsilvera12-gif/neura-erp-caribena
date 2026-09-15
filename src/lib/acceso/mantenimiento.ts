/**
 * BLOQUEO DE ACCESO AL ERP (modo mantenimiento) — REVERSIBLE, NO BORRA NADA.
 *
 * Con el bloqueo activo, los usuarios normales NO pueden ingresar al ERP. El rol
 * `super_admin` (y los correos bootstrap de NEURA) SÍ siguen entrando para poder
 * administrar. No se modifica ningún usuario, contraseña, `estado` ni dato: es
 * sólo una compuerta en el código.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PARA RESTAURAR EL ACCESO (cuando lo pidan), cualquiera de estas 3 alcanza:
 *   1) `git revert` del commit que activó el bloqueo y desplegar (rollback limpio).
 *   2) Poner ACCESO_BLOQUEADO_DEFAULT en false y desplegar.
 *   3) En Coolify, "Rollback" al deployment anterior al bloqueo.
 * También se puede forzar el estado SIN redeploy con la variable de entorno
 * `NEXT_PUBLIC_ACCESO_BLOQUEADO` = "false" (desbloquea) o "true" (bloquea).
 * Al restaurar, todos los usuarios vuelven a entrar exactamente como antes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Estado por defecto del bloqueo (lo que controla el commit/rollback). */
export const ACCESO_BLOQUEADO_DEFAULT = false;

/** Mensaje que ven los usuarios bloqueados. */
export const MENSAJE_MANTENIMIENTO =
  "El acceso al sistema está temporalmente deshabilitado por mantenimiento. " +
  "Volvé a intentar más tarde o contactá al administrador.";

/**
 * ¿Está bloqueado el acceso? La variable de entorno tiene prioridad sobre el
 * default del código, para poder desbloquear desde Coolify sin redeploy si hace
 * falta. Funciona igual en cliente y servidor (NEXT_PUBLIC).
 */
export function accesoBloqueado(): boolean {
  const env = process.env.NEXT_PUBLIC_ACCESO_BLOQUEADO?.trim().toLowerCase();
  if (env === "false" || env === "0") return false;
  if (env === "true" || env === "1") return true;
  return ACCESO_BLOQUEADO_DEFAULT;
}
