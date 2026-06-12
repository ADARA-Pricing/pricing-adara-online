"use client";

import { PageHero } from "@/components/PageHero";

export default function GeneralConfigPage() {
  return (
    <main className="container wide">
      <PageHero
        title="Configuración / General"
        description="Parámetros generales de la app."
        icon="⚙"
      />
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Configuración general</h2>
        <p className="small">Este espacio queda preparado para futuras configuraciones globales.</p>
      </section>
    </main>
  );
}
