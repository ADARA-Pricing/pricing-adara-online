"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";

type MeliStatus = {
  connected: boolean;
  account?: {
    nickname?: string | null;
    meli_user_id?: number | null;
    expires_at?: string | null;
    updated_at?: string | null;
  } | null;
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "-";
  }
}

export default function MercadoLibreConfigPage() {
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<MeliStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<any | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function loadStatus() {
    setError(null);
    try {
      const response = await fetch("/api/mercadolibre/status");
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error || "No se pudo consultar MercadoLibre.");
        return;
      }
      setStatus(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo consultar MercadoLibre.");
    }
  }

  async function syncMercadoLibre() {
    setSyncing(true);
    setMessage(null);
    setError(null);
    setLastSync(null);

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 300000);

      const response = await fetch("/api/mercadolibre/sync-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "shipping" }),
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));

      const data = await response.json();

      if (!response.ok) {
        setError(data?.error || "No se pudo sincronizar MercadoLibre.");
        return;
      }

      setLastSync(data);
      setMessage(`MercadoLibre sincronizado en ${Math.round((data.duration_ms || 0) / 1000)}s. Con costo actualizado: ${data.updated || 0}. Sin costo ML: ${data.no_shipping_cost || 0}.`);
      await loadStatus();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setError("La sincronización tardó demasiado y se cortó. Probá de nuevo o sincronizá menos publicaciones.");
      } else {
        setError(error instanceof Error ? error.message : "No se pudo sincronizar MercadoLibre.");
      }
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    checkSession();
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = Boolean(status?.connected);

  return (
    <main className="container wide config-ml-page">
      <PageHero
        title="Configuración / Conexión MercadoLibre"
        description="Gestioná tu cuenta de MercadoLibre y la sincronización con ADARA."
        onRefresh={loadStatus}
        icon="⚙"
      />

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="card ml-connection-card">
        <div className="ml-card-title">
          <h2>Estado de la conexión</h2>
        </div>

        <div className="ml-connection-layout">
          <div className="ml-logo-panel">
            <div className="meli-logo-mark">🤝</div>
            <div className="meli-logo-text">
              mercado
              <br />
              libre
            </div>
          </div>

          <div className="ml-status-table">
            <div>
              <span>Estado:</span>
              <strong>
                <span className={`ml-status-pill ${connected ? "connected" : "disconnected"}`}>
                  <span className="ml-status-dot" />
                  {connected ? "Conectado" : "Sin conectar"}
                </span>
              </strong>
            </div>
            <div>
              <span>Cuenta:</span>
              <strong>{status?.account?.nickname || "-"}</strong>
            </div>
            <div>
              <span>User ID:</span>
              <strong>{status?.account?.meli_user_id || "-"}</strong>
            </div>
            <div>
              <span>Última sincronización:</span>
              <strong>{formatDate(status?.account?.updated_at)}</strong>
            </div>
            <div>
              <span>Última respuesta:</span>
              <strong>
                {lastSync ? (
                  <span className="ml-status-pill connected">Exitosa</span>
                ) : (
                  "-"
                )}
              </strong>
            </div>
            <div>
              <span>Alcance:</span>
              <strong>Publicaciones, Envíos y Análisis</strong>
            </div>
          </div>

          <div className="ml-actions-panel">
            <h3>Acciones</h3>
            <a className="button ghost ml-wide-button" href="/api/mercadolibre/connect">
              {connected ? "Reconectar cuenta" : "Conectar MercadoLibre"}
            </a>
            <button
              className="button ml-wide-button"
              type="button"
              disabled={!connected || syncing}
              onClick={syncMercadoLibre}
            >
              {syncing ? "Sincronizando..." : "Sincronizar publicaciones / envíos"}
            </button>
            <p className="small">
              Sincronizá tus publicaciones y datos de envíos para mantener la información actualizada.
            </p>
          </div>
        </div>
      </section>

      {lastSync && (
        <section className="card ml-sync-metrics-card">
          <div className="ml-sync-metrics">
            <span>Publicaciones leídas: <strong>{lastSync.total_items || 0}</strong></span>
            <span>Estados ML: <strong>activas + pausadas</strong></span>
            <span>SKU encontrados: <strong>{lastSync.matched || 0}</strong></span>
            <span>Con costo actualizado: <strong>{lastSync.updated || 0}</strong></span>
            <span>Costo cambiado: <strong>{lastSync.changed || 0}</strong></span>
            <span>Sin costo ML: <strong>{lastSync.no_shipping_cost || 0}</strong></span>
            <span>SKU no encontrado: <strong>{lastSync.not_found || 0}</strong></span>
            <span>Sin SKU: <strong>{lastSync.without_sku || 0}</strong></span>
          </div>
        </section>
      )}

      <section className="card ml-usage-card">
        <div className="ml-card-title">
          <h2>Uso de la conexión</h2>
          <p className="small">Esta conexión habilita las siguientes funcionalidades en ADARA.</p>
        </div>

        <div className="ml-usage-grid">
          <div className="ml-usage-item">
            <span className="ml-usage-icon">▣</span>
            <div>
              <h3>Envíos</h3>
              <p>Traemos tus opciones de envío y costos desde MercadoLibre para usarlos en cálculos y márgenes por canal.</p>
            </div>
            <span className="ml-usage-chevron">›</span>
          </div>
          <div className="ml-usage-item">
            <span className="ml-usage-icon">◔</span>
            <div>
              <h3>Análisis</h3>
              <p>Usamos datos de ventas y costos de envío para generar análisis y métricas más precisas.</p>
            </div>
            <span className="ml-usage-chevron">›</span>
          </div>
          <div className="ml-usage-item">
            <span className="ml-usage-icon">⌑</span>
            <div>
              <h3>Publicaciones</h3>
              <p>Sincronizamos publicaciones para mantener precios, stock y condiciones siempre actualizados.</p>
            </div>
            <span className="ml-usage-chevron">›</span>
          </div>
          <div className="ml-usage-item">
            <span className="ml-usage-icon">↻</span>
            <div>
              <h3>Sincronización futura</h3>
              <p>Habilita futuras mejoras como descuentos automáticos, reglas inteligentes y más integraciones.</p>
            </div>
            <span className="ml-usage-chevron">›</span>
          </div>
        </div>

        <div className="ml-info-bar">
          <span>ⓘ</span>
          <strong>La conexión queda centralizada para toda la app.</strong>
        </div>
      </section>
    </main>
  );
}
