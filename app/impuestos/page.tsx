"use client";
import { usePricingLoad } from "@/lib/usePricingLoad";
import { PricingDataStatus } from "@/components/PricingDataStatus";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import { defaultTaxSettings, moneyWithCents, percent } from "@/lib/pricing";
import type { TaxSettings } from "@/lib/types";

function numberInput(value?: number | null) {
  return value === null || value === undefined ? "" : String(value);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "-";
  }
}

export default function TaxesPage() {
  const router = useRouter();
  const supabase = createClient();
  const dataLoad = usePricingLoad("impuestos", supabase);
  const [form, setForm] = useState<TaxSettings>(defaultTaxSettings());
  const [previewCost, setPreviewCost] = useState("10000");
  const [previewSalePrice, setPreviewSalePrice] = useState("21000");
  const [previewChannel, setPreviewChannel] = useState("MercadoLibre");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function loadData() { setLoading(true); setError(null); try { await dataLoad.run({ taxes: { table: 'tax_settings', filters: [['eq','key','default']] } }, data => setForm(data.taxes[0] || defaultTaxSettings())); } finally { setLoading(false); } }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof TaxSettings>(key: K, value: TaxSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const payload = {
      key: "default",
      iibb_rate: Number(form.iibb_rate || 0),
      idc_rate: Number(form.idc_rate || 0),
      iigg_rate: Number(form.iigg_rate || 0),
      structure_rate: Number(form.structure_rate || 0),
      notes: form.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("tax_settings").upsert(payload, { onConflict: "key" });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Configuración de impuestos guardada correctamente.");
    await loadData();
  }

  const preview = useMemo(() => {
    const cost = Number(previewCost || 0);
    const saleGross = Number(previewSalePrice || 0);
    const saleNet = saleGross / 1.21;

    const iibbAmount = saleNet * (Number(form.iibb_rate || 0) / 100);
    const idcAmount = saleNet * (Number(form.idc_rate || 0) / 100);
    const structureAmount = saleNet * (Number(form.structure_rate || 0) / 100);
    const grossMarginBeforeIigg = saleNet - cost - iibbAmount - idcAmount - structureAmount;
    const iiggAmount = Math.max(grossMarginBeforeIigg, 0) * (Number(form.iigg_rate || 0) / 100);
    const netProfit = grossMarginBeforeIigg - iiggAmount;
    const rentability = saleNet > 0 ? (netProfit / saleNet) * 100 : 0;

    return {
      cost,
      saleGross,
      saleNet,
      iibbAmount,
      idcAmount,
      structureAmount,
      grossMarginBeforeIigg,
      iiggAmount,
      netProfit,
      rentability,
    };
  }, [previewCost, previewSalePrice, form]);

  const totalRates =
    Number(form.iibb_rate || 0) +
    Number(form.idc_rate || 0) +
    Number(form.iigg_rate || 0) +
    Number(form.structure_rate || 0);

  return (
    <main className="container wide taxes-page">
      <PageHero
        title="Impuestos"
        description="Configuración global usada para calcular precios, márgenes y rentabilidad por canal."
        onRefresh={loadData}
        icon="▤"
      />
      <PricingDataStatus state={dataLoad.state} onRefresh={() => loadData()} />

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <form onSubmit={save}>
        <section className="card taxes-global-card">
          <div className="taxes-card-header">
            <div className="taxes-title-block">
              <span className="taxes-title-icon">◎</span>
              <div>
                <h2>1. Configuración global de impuestos</h2>
                <p className="small">
                  Estos valores se aplican en los cálculos de precios, simulador y márgenes por canal según la configuración seleccionada.
                </p>
              </div>
            </div>
            <button className="button taxes-save-button" disabled={saving}>
              {saving ? "Guardando..." : "Guardar configuración"}
            </button>
          </div>

          {dataLoad.initial ? (
            <p>Cargando...</p>
          ) : (
            <>
              <div className="taxes-input-grid">
                <div className="field tax-field">
                  <label>IIBB (%)</label>
                  <div className="input-suffix">
                    <input
                      type="number"
                      step="0.01"
                      value={numberInput(form.iibb_rate)}
                      onChange={(event) => update("iibb_rate", Number(event.target.value))}
                    />
                    <span>%</span>
                  </div>
                  <p className="field-help">Ingresos Brutos. Se calcula sobre el precio de venta sin IVA.</p>
                </div>

                <div className="field tax-field">
                  <label>IDC (%)</label>
                  <div className="input-suffix">
                    <input
                      type="number"
                      step="0.01"
                      value={numberInput(form.idc_rate)}
                      onChange={(event) => update("idc_rate", Number(event.target.value))}
                    />
                    <span>%</span>
                  </div>
                  <p className="field-help">
                    Impuesto al débito y crédito bancario. Se aplica sobre movimientos bancarios de dinero.
                  </p>
                </div>

                <div className="field tax-field">
                  <label>IIGG (%)</label>
                  <div className="input-suffix">
                    <input
                      type="number"
                      step="0.01"
                      value={numberInput(form.iigg_rate)}
                      onChange={(event) => update("iigg_rate", Number(event.target.value))}
                    />
                    <span>%</span>
                  </div>
                  <p className="field-help">Ganancias. Se calcula sobre el margen bruto estimado.</p>
                </div>

                <div className="field tax-field">
                  <label>Estructura (%)</label>
                  <div className="input-suffix">
                    <input
                      type="number"
                      step="0.01"
                      value={numberInput(form.structure_rate)}
                      onChange={(event) => update("structure_rate", Number(event.target.value))}
                    />
                    <span>%</span>
                  </div>
                  <p className="field-help">Costo operativo general del negocio aplicado al cálculo.</p>
                </div>

                <div className="field tax-field">
                  <label>Total tasas configuradas</label>
                  <input value={percent(totalRates)} disabled />
                  <p className="field-help">Referencia rápida. No todos los impuestos aplican sobre la misma base.</p>
                </div>

                <div className="field tax-field">
                  <label>Notas</label>
                  <input
                    value={form.notes || ""}
                    onChange={(event) => update("notes", event.target.value)}
                    placeholder="Ej: Ajuste IIBB / IDC / criterio del mes"
                  />
                  <p className="field-help">Usalo para recordar el motivo del cambio.</p>
                </div>
              </div>

              <div className="taxes-info-bar">
                <span>ⓘ</span>
                <strong>
                  IDC corresponde al Impuesto a los Débitos y Créditos Bancarios. En la app queda como porcentaje configurable porque puede aplicar distinto según el canal.
                </strong>
              </div>
            </>
          )}
        </section>
      </form>

      <section className="taxes-bottom-grid">
        <div className="card taxes-preview-card">
          <div className="taxes-title-block">
            <span className="taxes-title-icon">▦</span>
            <div>
              <h2>2. Vista previa del impacto</h2>
              <p className="small">Simulá cómo impactan los impuestos en un producto simple.</p>
            </div>
          </div>

          <div className="taxes-preview-inputs">
            <div className="field">
              <label>Costo sin IVA</label>
              <input
                type="number"
                step="0.01"
                value={previewCost}
                onChange={(event) => setPreviewCost(event.target.value)}
              />
            </div>
            <div className="field">
              <label>Precio venta con IVA</label>
              <input
                type="number"
                step="0.01"
                value={previewSalePrice}
                onChange={(event) => setPreviewSalePrice(event.target.value)}
              />
            </div>
            <div className="field">
              <label>Canal ejemplo</label>
              <select value={previewChannel} onChange={(event) => setPreviewChannel(event.target.value)}>
                <option>MercadoLibre</option>
                <option>Transferencia</option>
                <option>Efectivo</option>
                <option>Tienda online</option>
              </select>
            </div>
          </div>

          <div className="taxes-preview-table-wrap">
            <table className="taxes-preview-table">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Monto</th>
                  <th>% venta neta</th>
                  <th>Descripción</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Precio sin IVA</td>
                  <td>{moneyWithCents(preview.saleNet)}</td>
                  <td>-</td>
                  <td>Precio de venta neto de IVA</td>
                </tr>
                <tr>
                  <td>IIBB ({percent(form.iibb_rate || 0)})</td>
                  <td>{moneyWithCents(preview.iibbAmount)}</td>
                  <td>{percent(form.iibb_rate || 0)}</td>
                  <td>Sobre precio de venta sin IVA</td>
                </tr>
                <tr>
                  <td>IDC ({percent(form.idc_rate || 0)})</td>
                  <td>{moneyWithCents(preview.idcAmount)}</td>
                  <td>{percent(form.idc_rate || 0)}</td>
                  <td>Movimiento bancario estimado</td>
                </tr>
                <tr>
                  <td>IIGG ({percent(form.iigg_rate || 0)})</td>
                  <td>{moneyWithCents(preview.iiggAmount)}</td>
                  <td>{preview.saleNet > 0 ? percent((preview.iiggAmount / preview.saleNet) * 100) : "-"}</td>
                  <td>Sobre margen bruto positivo</td>
                </tr>
                <tr>
                  <td>Estructura ({percent(form.structure_rate || 0)})</td>
                  <td>{moneyWithCents(preview.structureAmount)}</td>
                  <td>{percent(form.structure_rate || 0)}</td>
                  <td>Costo operativo general</td>
                </tr>
                <tr className="taxes-result-row">
                  <td>Ganancia neta estimada</td>
                  <td>{moneyWithCents(preview.netProfit)}</td>
                  <td>{percent(preview.rentability)}</td>
                  <td>Después de impuestos</td>
                </tr>
                <tr className="taxes-result-row light">
                  <td>Rentabilidad neta</td>
                  <td>{percent(preview.rentability)}</td>
                  <td>-</td>
                  <td>Sobre precio sin IVA</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card taxes-application-card">
          <div className="taxes-title-block">
            <span className="taxes-title-icon">▣</span>
            <div>
              <h2>3. Resumen de aplicación</h2>
              <p className="small">Dónde aplica cada impuesto y cómo afecta la rentabilidad.</p>
            </div>
          </div>

          <div className="tax-application-list">
            <div>
              <span className="tax-mini-icon">⌑</span>
              <strong>IIBB</strong>
              <p>Se calcula sobre el precio de venta sin IVA. Impacta directamente en la rentabilidad.</p>
            </div>
            <div>
              <span className="tax-mini-icon">$</span>
              <strong>IDC</strong>
              <p>Impuesto a los débitos y créditos bancarios. Representa el costo por movimientos de dinero.</p>
            </div>
            <div>
              <span className="tax-mini-icon">▥</span>
              <strong>IIGG</strong>
              <p>Se calcula sobre el margen bruto positivo. Afecta la ganancia neta del producto.</p>
            </div>
            <div>
              <span className="tax-mini-icon">▤</span>
              <strong>Estructura</strong>
              <p>Costo operativo general del negocio. Se usa como carga global configurable.</p>
            </div>
            <div>
              <span className="tax-mini-icon">%</span>
              <strong>IVA</strong>
              <p>El IVA se toma desde cada producto o condición de venta, no desde esta configuración global.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="card taxes-last-update-card">
        <div className="taxes-title-block">
          <span className="taxes-title-icon">◷</span>
          <div>
            <h2>Última actualización</h2>
          </div>
        </div>
        <div className="taxes-last-update-grid">
          <div>
            <span>Fecha y hora</span>
            <strong>{formatDateTime(form.updated_at)}</strong>
          </div>
          <div>
            <span>Usuario</span>
            <strong>Admin Mercado</strong>
          </div>
          <div>
            <span>Notas</span>
            <strong>{form.notes || "-"}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}
