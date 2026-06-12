"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

const mainItems = [
  { href: "/productos", label: "Productos", icon: "▧" },
  { href: "/mercadolibre", label: "Costo x canal", icon: "◇" },
  { href: "/envios-meli", label: "Envíos", icon: "▣" },
  { href: "/impuestos", label: "Impuestos", icon: "▤" },
  { href: "/precios", label: "Precios", icon: "⌁" },
  { href: "/simulador", label: "Simulador", icon: "⌁" },
];

const configItems = [
  { href: "/configuracion/mercadolibre", label: "Conexión MercadoLibre" },
  { href: "/configuracion/general", label: "General" },
];

function isActive(pathname: string | null, href: string) {
  return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const publicPage = pathname === "/" || pathname?.startsWith("/login");
  if (publicPage) return <>{children}</>;

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const configActive = configItems.some((item) => isActive(pathname, item.href));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo-row">
          <Link href="/precios" className="adara-logo" aria-label="ADARA">
            <span className="adara-logo-main">ADARA</span>
            <span className="adara-logo-sub">Group</span>
          </Link>
          <button type="button" className="sidebar-collapse" aria-label="Contraer menú">
            ≪
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Navegación principal">
          <Link href="/precios" className={`sidebar-link ${isActive(pathname, "/precios") ? "active" : ""}`}>
            <span className="sidebar-icon">⌂</span>
            <span>Inicio</span>
          </Link>

          {mainItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${isActive(pathname, item.href) ? "active" : ""}`}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}

          <div className={`sidebar-link sidebar-section ${configActive ? "active-section" : ""}`}>
            <span className="sidebar-icon">⚙</span>
            <span>Configuración</span>
            <span className="sidebar-caret">⌃</span>
          </div>

          <div className="sidebar-submenu">
            {configItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-sublink ${isActive(pathname, item.href) ? "active" : ""}`}
              >
                <span className="sidebar-dot" />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </nav>

        <div className="sidebar-bottom">
          <button className="sidebar-link sidebar-logout" type="button" onClick={logout}>
            <span className="sidebar-icon">↩</span>
            <span>Salir</span>
          </button>

          <div className="sidebar-user">
            <div className="sidebar-avatar">AM</div>
            <div>
              <strong>Admin Mercado</strong>
              <span>admin@adara.com</span>
            </div>
            <span className="sidebar-user-caret">⌄</span>
          </div>
        </div>
      </aside>

      <div className="app-content">
        {children}
      </div>
    </div>
  );
}
