"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/productos", label: "Productos" },
  { href: "/metricas-meli", label: "Metricas ML / Negocio" },
  { href: "/rotacion-sku", label: "Metricas ML / Rotacion SKU" },
  { href: "/rentabilidad-meli", label: "Metricas ML / Rentabilidad" },
  { href: "/mercadolibre", label: "Costo x canal" },
  { href: "/tienda-nube", label: "Tienda Nube" },
  { href: "/impuestos", label: "Impuestos" },
  { href: "/precios", label: "Precios" },
  { href: "/simulador", label: "Simulador" },
];

export function AppNav({ onLogout }: { onLogout?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="nav app-nav">
      {items.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            className={`button ghost nav-link${active ? " active" : ""}`}
            href={item.href}
          >
            {item.label}
          </Link>
        );
      })}
      {onLogout && (
        <button className="button secondary nav-logout" onClick={onLogout}>
          Salir
        </button>
      )}
    </nav>
  );
}
