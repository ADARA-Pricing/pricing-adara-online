"use client";

import { ReactNode } from "react";
import { AppNav } from "@/components/AppNav";

export function PageHero({
  title,
  description,
  onRefresh,
  onLogout,
  icon = "⌁",
}: {
  title: string;
  description: ReactNode;
  onRefresh?: () => void;
  onLogout?: () => void;
  icon?: ReactNode;
}) {
  return (
    <header className="header prices-hero app-page-hero">
      <div className="prices-hero-left">
        <div className="prices-hero-icon">{icon}</div>
        <div className="brand">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="nav prices-hero-nav page-hero-actions">
        {onRefresh && (
          <button className="button ghost page-refresh-button" onClick={onRefresh} type="button">
            ↻ Actualizar
          </button>
        )}
        <AppNav onLogout={onLogout} />
      </div>
    </header>
  );
}
