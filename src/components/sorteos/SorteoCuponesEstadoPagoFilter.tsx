"use client";

import SelectField from "@/components/ui/SelectField";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";

function Inner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const raw = sp?.get("estado")?.trim() ?? "";
  const value =
    raw === "pendiente_revision" || raw === "confirmado" || raw === "rechazado" ? raw : "";

  const applyEstado = useCallback(
    (nextEstado: string) => {
      const p = new URLSearchParams(sp?.toString() ?? "");
      if (nextEstado && nextEstado.length > 0) {
        p.set("estado", nextEstado);
      } else {
        p.delete("estado");
      }
      p.delete("page");
      const qs = p.toString();
      const path = pathname ?? "/sorteos/cupones";
      router.replace(qs ? `${path}?${qs}` : path);
    },
    [pathname, router, sp]
  );

  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      Estado pago
      <SelectField
        value={value}
        className="border border-slate-300 rounded px-2 py-1.5 text-sm min-w-[180px]"
        onChange={(e) => applyEstado(e.target.value)}
        aria-label="Filtrar por estado de pago"
      >
        <option value="">Todos</option>
        <option value="pendiente_revision">Pendiente revisión</option>
        <option value="confirmado">Aprobado</option>
        <option value="rechazado">Rechazado</option>
      </SelectField>
    </label>
  );
}

/** Selector Cupones: etiquetas alineadas a la columna Pago; valores técnicos sin cambios en BD. */
export default function SorteoCuponesEstadoPagoFilter() {
  return (
    <Suspense
      fallback={
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Estado pago
          <SelectField className="border border-slate-300 rounded px-2 py-1.5 text-sm min-w-[180px]" disabled>
            <option>Cargando…</option>
          </SelectField>
        </label>
      }
    >
      <Inner />
    </Suspense>
  );
}
