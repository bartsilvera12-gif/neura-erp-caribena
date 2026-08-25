/**
 * Resuelve la ruta actual a "módulo / página" para la miga de pan del header.
 *
 * Es un mapa propio y no una lectura del menú del Sidebar a propósito: el menú
 * se filtra por módulos habilitados y por rol, así que un usuario sin permiso
 * sobre una sección igual necesita ver el título correcto de la pantalla en la
 * que está. Acá interesa dónde estás, no a dónde podés ir.
 */

type Entrada = { seccion: string; titulo: string };

/** Prefijos ordenados de más específico a más general (gana el más largo). */
const RUTAS: Record<string, Entrada> = {
  "/": { seccion: "General", titulo: "Dashboard" },

  "/dashboard/conversaciones": { seccion: "Omnicanal", titulo: "Conversaciones" },
  "/dashboard/historial-omnicanal": { seccion: "Omnicanal", titulo: "Historial omnicanal" },
  "/dashboard/conversaciones-finalizadas": { seccion: "Omnicanal", titulo: "Finalizadas" },
  "/dashboard/monitoreo": { seccion: "Omnicanal", titulo: "Monitoreo" },

  "/mesas": { seccion: "Salón", titulo: "Mesas" },
  "/comandas": { seccion: "Salón", titulo: "Comandas" },
  "/pedidos-para-llevar": { seccion: "Salón", titulo: "Pedidos para llevar" },
  "/dashboard/proyectos": { seccion: "Salón", titulo: "Pedidos" },

  "/ventas": { seccion: "Comercial", titulo: "Caja" },
  "/clientes": { seccion: "Comercial", titulo: "Clientes" },
  "/gestion-clientes": { seccion: "Comercial", titulo: "Gestión de clientes" },
  "/crm": { seccion: "Comercial", titulo: "CRM Funnel" },
  "/facturas": { seccion: "Comercial", titulo: "Facturas" },
  "/pagos": { seccion: "Comercial", titulo: "Pagos" },

  "/inventario/movimientos": { seccion: "Operaciones", titulo: "Movimientos de inventario" },
  "/inventario/categorias": { seccion: "Operaciones", titulo: "Categorías" },
  "/inventario/ubicaciones": { seccion: "Operaciones", titulo: "Ubicaciones" },
  "/inventario": { seccion: "Operaciones", titulo: "Inventario" },
  "/dashboard/recetas": { seccion: "Operaciones", titulo: "Recetas" },
  "/compras": { seccion: "Operaciones", titulo: "Compras" },
  "/proveedores": { seccion: "Operaciones", titulo: "Proveedores" },
  "/gastos": { seccion: "Operaciones", titulo: "Gastos" },

  "/reportes": { seccion: "Contable", titulo: "Reportes" },
  "/comisiones": { seccion: "Contable", titulo: "Comisiones" },
  "/notas-credito": { seccion: "Contable", titulo: "Notas de crédito" },

  "/dashboard/campanas": { seccion: "Marketing", titulo: "Campañas" },
  "/dashboard/marketing-ops": { seccion: "Marketing", titulo: "Marketing Ops" },
  "/marketing": { seccion: "Marketing", titulo: "Marketing" },
  "/sorteos": { seccion: "Marketing", titulo: "Sorteos" },

  "/usuarios": { seccion: "Administración", titulo: "Usuarios" },
  "/configuracion": { seccion: "Administración", titulo: "Configuración" },
  "/planes": { seccion: "Administración", titulo: "Planes" },
  "/admin/empresas": { seccion: "Administración", titulo: "Empresas" },
};

/** Sufijos de ruta que describen la acción, no una pantalla nueva del menú. */
const ACCIONES: Record<string, string> = {
  nuevo: "Nuevo",
  nueva: "Nueva",
  editar: "Editar",
  historial: "Historial",
  tipificacion: "Tipificación",
  configuracion: "Configuración",
  operacion: "Operación",
  flujos: "Flujos",
};

function capitalizar(s: string): string {
  const limpio = s.replace(/-/g, " ").trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

export type MigaDePan = { seccion: string; titulo: string; accion: string | null };

export function resolverRuta(pathname: string): MigaDePan | null {
  if (!pathname) return null;

  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  // El prefijo más largo que coincida gana, por eso "/inventario/movimientos"
  // se resuelve antes que "/inventario".
  let mejor: { prefijo: string; entrada: Entrada } | null = null;
  for (const [prefijo, entrada] of Object.entries(RUTAS)) {
    const coincide = prefijo === "/" ? path === "/" : path === prefijo || path.startsWith(`${prefijo}/`);
    if (!coincide) continue;
    if (!mejor || prefijo.length > mejor.prefijo.length) mejor = { prefijo, entrada };
  }

  if (!mejor) {
    const primero = path.split("/").filter(Boolean)[0];
    if (!primero) return null;
    return { seccion: "Neura ERP", titulo: capitalizar(primero), accion: null };
  }

  // El último segmento solo se muestra si es una acción conocida; un id (uuid,
  // número) no aporta nada en la miga de pan.
  const resto = path.slice(mejor.prefijo.length).split("/").filter(Boolean);
  const ultimo = resto.length > 0 ? resto[resto.length - 1] : null;
  const accion = ultimo && ACCIONES[ultimo] ? ACCIONES[ultimo] : null;

  return { seccion: mejor.entrada.seccion, titulo: mejor.entrada.titulo, accion };
}
