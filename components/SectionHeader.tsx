"use client";

import { ReactNode } from "react";

export function SectionHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div className="section-header-main">
        {icon && <span className="section-header-icon">{icon}</span>}
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </div>
      {actions && <div className="section-header-actions">{actions}</div>}
    </div>
  );
}
