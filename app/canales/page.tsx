"use client";

import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
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
      <PageHero
        title="Canales"
        description="Esta sección fue separada en MercadoLibre e Impuestos."
        onLogout={logout}
      />
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
