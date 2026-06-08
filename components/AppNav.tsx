"use client";

import Link from "next/link";

export function AppNav({ onLogout }: { onLogout?: () => void }) {
  return (
    <nav className="nav">
      <Link className="button ghost" href="/productos">Productos</Link>
      <Link className="button ghost" href="/mercadolibre">MercadoLibre</Link>
      <Link className="button ghost" href="/impuestos">Impuestos</Link>
      <Link className="button ghost" href="/precios">Precios</Link>
      {onLogout && <button className="button secondary" onClick={onLogout}>Salir</button>}
    </nav>
  );
}
