"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BadgePercent,
  Calculator,
  ChartNoAxesCombined,
  Compass,
  LayoutDashboard,
  LogOut,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  ReceiptText,
  RefreshCcw,
  Settings,
  SlidersHorizontal,
  Tags,
  Target,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

function SidebarIcon({ icon: Icon, active = false, sub = false }: { icon: LucideIcon; active?: boolean; sub?: boolean }) {
  return <Icon aria-hidden="true" className="sidebar-icon-svg" size={sub ? 16 : 18} strokeWidth={active ? 2 : 1.8} />;
}

const mainItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/oportunidades", label: "Oportunidades", icon: Target },
  { href: "/rotacion-sku", label: "Rotacion SKU", icon: RefreshCcw },
  { href: "/productos", label: "Productos", icon: Package },
  { href: "/mercadolibre", label: "Costo x canal", icon: ChartNoAxesCombined },
  { href: "/impuestos", label: "Impuestos", icon: ReceiptText },
  { href: "/precios", label: "Precios", icon: Tags },
  { href: "/promociones-meli", label: "Promociones Meli", icon: BadgePercent },
  { href: "/asesoria-360", label: "Asesoria 360", icon: Compass },
  { href: "/simulador", label: "Simulador", icon: Calculator },
];

const configItems: NavItem[] = [
  { href: "/configuracion/mercadolibre", label: "Conexion MercadoLibre", icon: Plug },
  { href: "/configuracion/general", label: "General", icon: SlidersHorizontal },
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
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-logo-row">
          <Link href="/dashboard" className="adara-logo" aria-label="ADARA">
            <img src="/logo-adara.png" alt="ADARA Group" />
            <span className="adara-logo-mark" aria-hidden="true">A</span>
          </Link>
          <button type="button" className="sidebar-collapse" aria-label={collapsed ? "Expandir menu" : "Contraer menu"} onClick={toggleCollapsed}>
            <CollapseIcon aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Navegacion principal">
          {mainItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${active ? "active" : ""}`}
                title={collapsed ? item.label : undefined}
              >
                <span className="sidebar-icon"><SidebarIcon icon={item.icon} active={active} /></span>
                <span className="sidebar-label">{item.label}</span>
              </Link>
            );
          })}

          <div className={`sidebar-link sidebar-section ${configActive ? "active-section" : ""}`}>
            <span className="sidebar-icon"><SidebarIcon icon={Settings} active={configActive} /></span>
            <span className="sidebar-label">Configuracion</span>
            <span className="sidebar-caret">⌃</span>
          </div>

          <div className="sidebar-submenu">
            {configItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`sidebar-sublink ${active ? "active" : ""}`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="sidebar-icon sidebar-subicon"><SidebarIcon icon={item.icon} active={active} sub /></span>
                  <span className="sidebar-label">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="sidebar-bottom">
          <button className="sidebar-link sidebar-logout" type="button" onClick={logout}>
            <span className="sidebar-icon"><SidebarIcon icon={LogOut} /></span>
            <span className="sidebar-label">Salir</span>
          </button>

          <div className="sidebar-user">
            <div className="sidebar-avatar">{initialsFromEmail(userEmail)}</div>
            <div>
              <strong>{nameFromEmail(userEmail)}</strong>
              <span>{userEmail || "Sesion activa"}</span>
            </div>
            <span className="sidebar-user-caret">⌄</span>
          </div>
        </div>
      </aside>

      <div className="app-content">{children}</div>
    </div>
  );
}
