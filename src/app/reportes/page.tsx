"use client";

import Link from "next/link";
import { BarChart3, Receipt, Landmark } from "lucide-react";

function ReportCard({
  href, titulo, descripcion, boton, icon: Icon,
}: {
  href: string; titulo: string; descripcion: string; boton: string; icon: typeof BarChart3;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/15 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[#0EA5E9]">
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="text-base font-semibold text-slate-800">{titulo}</h2>
      </div>
      <p className="mt-3 flex-1 text-sm text-slate-500">{descripcion}</p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center justify-center rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#0284C7]"
      >
        {boton}
      </Link>
    </div>
  );
}

export default function ReportesPage() {
  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" style={{ boxShadow: "0 0 0 3px rgba(79,174,178,0.18)" }} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Zentra · Operaciones</p>
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Reportes</h1>
        <p className="mt-0.5 text-xs text-slate-500">Cierres de caja y estado de cuenta de la lomitería</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ReportCard
          href="/reportes/cierres-caja"
          titulo="Cierres de caja"
          descripcion="Aperturas, cierres, movimientos y diferencias por turno."
          boton="Ver cierres"
          icon={BarChart3}
        />
        <ReportCard
          href="/reportes/estado-cuenta"
          titulo="Estado de cuenta de la lomitería"
          descripcion="Resumen financiero por cajas cerradas."
          boton="Ver estado"
          icon={Receipt}
        />
        <ReportCard
          href="/reportes/conciliacion-bancaria"
          titulo="Conciliación bancaria"
          descripcion="Control de pagos por transferencia y tarjeta asociados a cajas y ventas."
          boton="Ver conciliación"
          icon={Landmark}
        />
      </div>
    </div>
  );
}
