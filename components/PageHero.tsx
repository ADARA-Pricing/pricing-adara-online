"use client";

import { ReactNode } from "react";

function HeroSvg({ title }: { title: string }) {
  const normalized = title.toLowerCase();
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (normalized.includes("producto")) {
    return (
      <svg {...commonProps}>
        <rect x="4" y="4" width="16" height="16" rx="2.5" />
        <path d="M4 9h16" />
        <path d="M9 4v16" />
      </svg>
    );
  }

  if (normalized.includes("rentabilidad")) {
    return (
      <svg {...commonProps}>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M7 15l3-3 3 2 5-7" />
        <path d="M16 7h2v2" />
      </svg>
    );
  }

  if (normalized.includes("mercado")) {
    return (
      <svg {...commonProps}>
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="M15 15l4 4" />
        <path d="M8.5 10.5h4" />
        <path d="M10.5 8.5v4" />
      </svg>
    );
  }

  if (normalized.includes("promoc")) {
    return (
      <svg {...commonProps}>
        <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7" />
        <path d="M2.5 7.5h19v4h-19z" />
        <path d="M12 21V7.5" />
        <path d="M12 7.5H8.5a2.5 2.5 0 1 1 2.2-3.7L12 7.5Z" />
        <path d="M12 7.5h3.5a2.5 2.5 0 1 0-2.2-3.7L12 7.5Z" />
      </svg>
    );
  }

  if (normalized.includes("simulador")) {
    return (
      <svg {...commonProps}>
        <rect x="5" y="3.5" width="14" height="17" rx="3" />
        <path d="M8 8h8" />
        <path d="M8 12h3" />
        <path d="M13 12h3" />
        <path d="M8 16h8" />
      </svg>
    );
  }

  if (normalized.includes("env")) {
    return (
      <svg {...commonProps}>
        <path d="M3 7h11v8H3z" />
        <path d="M14 10h3l3 3v2h-6z" />
        <circle cx="8" cy="18" r="1.7" />
        <circle cx="18" cy="18" r="1.7" />
      </svg>
    );
  }

  if (normalized.includes("impuesto")) {
    return (
      <svg {...commonProps}>
        <path d="M6 4h9l3 3v13H6z" />
        <path d="M15 4v4h4" />
        <path d="M9 12h6" />
        <path d="M9 16h6" />
      </svg>
    );
  }

  if (normalized.includes("precio") || normalized.includes("costo")) {
    return (
      <svg {...commonProps}>
        <path d="M7 7h10" />
        <path d="M7 12h7" />
        <path d="M7 17h10" />
        <circle cx="17" cy="12" r="3" />
      </svg>
    );
  }

  if (normalized.includes("config") || normalized.includes("conex")) {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7.8 7.8 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.7a7.8 7.8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1a7.8 7.8 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7.8 7.8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function PageHero({
  title,
  description,
  onRefresh,
  refreshLabel = "Actualizar",
  refreshDisabled = false,
  icon,
  actions,
}: {
  title: string;
  description: ReactNode;
  onRefresh?: () => void;
  refreshLabel?: string;
  refreshDisabled?: boolean;
  onLogout?: () => void;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="header prices-hero app-page-hero">
      <div className="prices-hero-left">
        <div className="prices-hero-icon">{icon && typeof icon !== "string" ? icon : <HeroSvg title={title} />}</div>
        <div className="brand">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="page-hero-actions">
        {actions}
        {onRefresh && (
          <button className="button ghost page-refresh-button" onClick={onRefresh} type="button" disabled={refreshDisabled}>
            {refreshLabel}
          </button>
        )}
      </div>
    </header>
  );
}
