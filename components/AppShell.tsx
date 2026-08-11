"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

function IconProducts() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon-svg" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M4 9h16" />
      <path d="M9 4v16" />
    </svg>
  );
}

function IconChannels() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon-svg" aria-hidden="true">
      <path d="M5 7h14" />
      <path d="M5 12h9" />
      <path d="M5 17h14" />
      <circle cx="17" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconShipping() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon-svg" aria-hidden="true">
      <path d="M3 7h11v8H3z" />
      <path d="M14 10h3l3 3v2h-6z" />
      <circle cx="8" cy="18" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="18" cy="18" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconTaxes() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon-svg" aria-hidden="true">
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M15 4v4h4" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}

function IconPrices() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon-svg" aria-hidden="true">
      <path d="M7 7h10" />
      <path d="M7 12h7" />
      <path d="M7 17h10" />
      <circle cx="17" cy="12" r="3" />
    </svg>
  );
}

function IconSimulator() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon-svg" aria-hidden="true">
      <rect x="5" y="3.5" width="14" height="17" rx="3" />
      <path d="M8 8h8" />
      <path d="M8.5 12.5h.01" />
      <path d="M12 12.5h.01" />
      <path d="M15.5 12.5h.01" />
      <path d="M8.5 16h.01" />
      <path d="M12 16h.01" />
      <path d="M15.5 16h.01" />
    </svg>
  );
}

function IconPromotions() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon-svg" aria-hidden="true">
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7" />
      <path d="M2.5 7.5h19v4h-19z" />
      <path d="M12 21V7.5" />
      <path d="M12 7.5H8.5a2.5 2.5 0 1 1 2.2-3.7L12 7.5Z" />
      <path d="M12 7.5h3.5a2.5 2.5 0 1 0-2.2-3.7L12 7.5Z" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon-svg" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.7-.9 1 1 0 0 0-1 .2l-.2.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1l-.1-.2a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .7.9 1 1 0 0 0 1-.2l.2-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.7Z" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon-svg" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

const mainItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <IconPrices /> },
  { href: "/productos", label: "Productos", icon: <IconProducts /> },
  { href: "/mercadolibre", label: "Costo x canal", icon: <IconChannels /> },
  { href: "/envios-meli", label: "Envíos", icon: <IconShipping /> },
  { href: "/impuestos", label: "Impuestos", icon: <IconTaxes /> },
  { href: "/precios", label: "Precios", icon: <IconPrices /> },
  { href: "/promociones-meli", label: "Promociones Meli", icon: <IconPromotions /> },
  { href: "/asesoria-360", label: "Asesoria 360", icon: <IconPromotions /> },
  { href: "/simulador", label: "Simulador", icon: <IconSimulator /> },
];

const configItems = [
  { href: "/configuracion/mercadolibre", label: "Conexión MercadoLibre" },
  { href: "/configuracion/general", label: "General" },
];

function isActive(pathname: string | null, href: string) {
  return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}

function initialsFromEmail(email?: string | null) {
  if (!email) return "AD";
  const name = email.split("@")[0] || "AD";
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function nameFromEmail(email?: string | null) {
  if (!email) return "Usuario ADARA";
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [collapsed, setCollapsed] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const publicPage = pathname === "/" || pathname?.startsWith("/login");

  useEffect(() => {
    const stored = window.localStorage.getItem("adara-sidebar-collapsed");
    if (stored) setCollapsed(stored === "true");
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("adara-sidebar-collapsed", String(next));
      return next;
    });
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (publicPage) return <>{children}</>;

  const configActive = configItems.some((item) => isActive(pathname, item.href));

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-logo-row">
          <Link href="/dashboard" className="adara-logo" aria-label="ADARA">
            <img src="/logo-adara.png" alt="ADARA Group" />
            <span className="adara-logo-mark" aria-hidden="true">A</span>
          </Link>
          <button type="button" className="sidebar-collapse" aria-label={collapsed ? "Expandir menú" : "Contraer menú"} onClick={toggleCollapsed}>
            {collapsed ? ">" : "<"}
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Navegación principal">
          {mainItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${isActive(pathname, item.href) ? "active" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">{item.label}</span>
            </Link>
          ))}

          <div className={`sidebar-link sidebar-section ${configActive ? "active-section" : ""}`}>
            <span className="sidebar-icon"><IconSettings /></span>
            <span className="sidebar-label">Configuración</span>
            <span className="sidebar-caret">⌃</span>
          </div>

          <div className="sidebar-submenu">
            {configItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-sublink ${isActive(pathname, item.href) ? "active" : ""}`}
                title={collapsed ? item.label : undefined}
              >
                <span className="sidebar-dot" />
                <span className="sidebar-label">{item.label}</span>
              </Link>
            ))}
          </div>
        </nav>

        <div className="sidebar-bottom">
          <button className="sidebar-link sidebar-logout" type="button" onClick={logout}>
            <span className="sidebar-icon"><IconLogout /></span>
            <span className="sidebar-label">Salir</span>
          </button>

          <div className="sidebar-user">
            <div className="sidebar-avatar">{initialsFromEmail(userEmail)}</div>
            <div>
              <strong>{nameFromEmail(userEmail)}</strong>
              <span>{userEmail || "Sesión activa"}</span>
            </div>
            <span className="sidebar-user-caret">⌄</span>
          </div>
        </div>
      </aside>

      <div className="app-content">{children}</div>
    </div>
  );
}
