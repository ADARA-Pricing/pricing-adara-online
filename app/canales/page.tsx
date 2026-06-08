"use client";

import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { createClient } from "@/lib/supabase";

export default function ChannelsPage() {
  const router = useRouter();
  const supabase = createClient();

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <main className="container">
      <header className="header">
        <div className="brand">
          <h1>Canales</h1>
          <p>Esta sección fue separada en MercadoLibre e Impuestos.</p>
        </div>
        <AppNav onLogout={logout} />
      </header>
      <section className="card">
        <p>Para configurar MercadoLibre entrá en la solapa <strong>MercadoLibre</strong>. Para IIBB, IDC, IIGG y estructura entrá en <strong>Impuestos</strong>.</p>
        <div className="nav" style={{ marginTop: 16 }}>
          <button className="button" onClick={() => router.push("/mercadolibre")}>Ir a MercadoLibre</button>
          <button className="button ghost" onClick={() => router.push("/impuestos")}>Ir a Impuestos</button>
        </div>
      </section>
    </main>
  );
}
