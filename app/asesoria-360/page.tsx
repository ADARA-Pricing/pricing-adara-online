"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import {
  calculatePriceSummary,
  defaultTaxSettings,
  mercadoLibreClassicOption,
  moneyWithCents,
  normalizeOption,
  toNumber,
} from "@/lib/pricing";
import type {
  MercadoLibreCategoryFee,
  MercadoLibreInstallmentFee,
  MercadoLibrePriceOption,
  MercadoLibreShippingCost,
  Product,
  ProductChannelMargin,
  TaxSettings,
} from "@/lib/types";

type AdvisoryDraftRow = {
  id: string;
  accountName: string;
  date: string;
  sku: string;
  productName: string;
  itemId: string;
  itemTitle: string;
  installmentLabel: string;
  salePrice: number;
  offerPrice: number;
  targetMargin: number;
};

const STORAGE_KEY = "adara-asesoria-360-draft";
const ACCOUNT_NAME = "ADARA RS";
const MAX_ROWS = 40;

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextWeekday(day: number) {
  const date = new Date();
  const current = date.getDay();
  let diff = day - current;
  if (diff <= 0) diff += 7;
  date.setDate(date.getDate() + diff);
  return dateInputValue(date);
}

function formatSheetDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function numberForSheet(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function itemIdWithoutPrefix(itemId?: string | null) {
  return (itemId || "").replace(/^MLA/i, "");
}

function publicationInstallments(publication: MercadoLibreShippingCost) {
  const text = `${publication.meli_installments_text || ""} ${publication.notes || ""}`.toLowerCase();
  const match = text.match(/(\d+)\s*cuota/);
  if (match) return Number(match[1]);
  if (text.includes("sin cuotas") || text.includes("1 pago")) return 1;
  return null;
}

function optionLabelForPublication(publication: MercadoLibreShippingCost) {
  const installments = publicationInstallments(publication);
  if (!installments || installments <= 1) return "1 pago";
  return `${installments} cuotas`;
}

function sortPricingOptions(options: MercadoLibrePriceOption[]) {
  const fixedOrder: Record<string, number> = { MC: 1, MP3: 2, MP6: 3, MP9: 4, MP12: 5 };
  return [...options].sort((a, b) => {
    const orderA = fixedOrder[a.code] ?? 1000;
    const orderB = fixedOrder[b.code] ?? 1000;
    if (orderA !== orderB) return orderA - orderB;
    return a.code.localeCompare(b.code, "es");
  });
}

export default function Asesoria360Page() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>([]);
  const [query, setQuery] = useState("");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(nextWeekday(1));
  const [targetMargin, setTargetMargin] = useState(5);
  const [draftRows, setDraftRows] = useState<AdvisoryDraftRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    const [
      productsResponse,
      publicationsResponse,
      installmentsResponse,
      categoryFeesResponse,
      taxesResponse,
      marginsResponse,
    ] = await Promise.all([
      supabase.from("products").select("*").neq("status", "discontinued").order("sku", { ascending: true }),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true).eq("meli_status", "active").order("sku", { ascending: true }),
      supabase.from("mercadolibre_installment_fees").select("*").eq("active", true).order("code", { ascending: true }),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
      supabase.from("tax_settings").select("*").eq("key", "default").single(),
      supabase.from("product_channel_margins").select("*"),
    ]);
    setLoading(false);

    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);
    if (publicationsResponse.error) setError(publicationsResponse.error.message);
    else setPublications((publicationsResponse.data || []) as MercadoLibreShippingCost[]);
    if (installmentsResponse.error) setError(installmentsResponse.error.message);
    else setInstallments(((installmentsResponse.data || []) as MercadoLibreInstallmentFee[]).filter((item) => item.code !== "MC"));
    if (categoryFeesResponse.error) setError(categoryFeesResponse.error.message);
    else setCategoryFees((categoryFeesResponse.data || []) as MercadoLibreCategoryFee[]);
    if (taxesResponse.error) setError(taxesResponse.error.message);
    else setTaxes((taxesResponse.data || defaultTaxSettings()) as TaxSettings);
    if (marginsResponse.error) setError(marginsResponse.error.message);
    else setMarginSettings((marginsResponse.data || []) as ProductChannelMargin[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AdvisoryDraftRow[];
        if (Array.isArray(parsed)) setDraftRows(parsed);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draftRows));
  }, [draftRows]);

  const pricingOptions = useMemo<MercadoLibrePriceOption[]>(() => {
    return sortPricingOptions([
      mercadoLibreClassicOption(),
      ...installments.map((item) =>
        normalizeOption({
          code: item.code,
          name: item.name,
          channel_type: item.channel_type,
          installment_count: item.installment_count,
          financing_fee_rate: item.financing_fee_rate,
          applies_marketplace_fee: item.applies_marketplace_fee,
          applies_shipping: item.applies_shipping,
          applies_iibb: item.applies_iibb,
          applies_idc: item.applies_idc,
          applies_iigg: item.applies_iigg,
          applies_structure: item.applies_structure,
          applies_vat: item.applies_vat,
          active: item.active,
        }),
      ),
    ]);
  }, [installments]);

  const productsBySku = useMemo(() => new Map(products.map((product) => [product.sku, product])), [products]);

  const publicationsBySku = useMemo(() => {
    const map = new Map<string, MercadoLibreShippingCost[]>();
    publications.forEach((publication) => {
      const sku = publication.sku || products.find((product) => product.id === publication.product_id)?.sku;
      if (!sku || !publication.meli_item_id) return;
      const current = map.get(sku) || [];
      current.push(publication);
      map.set(sku, current);
    });
    return map;
  }, [products, publications]);

  const productGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .map((product) => ({ product, publications: publicationsBySku.get(product.sku) || [] }))
      .filter((group) => group.publications.length > 0)
      .filter((group) => {
        const text = `${group.product.sku} ${group.product.name} ${group.product.brand || ""} ${group.product.model || ""}`.toLowerCase();
        return !q || text.includes(q);
      })
      .slice(0, 250);
  }, [products, publicationsBySku, query]);

  const selectedProduct = selectedSku ? productsBySku.get(selectedSku) || null : null;
  const selectedPublications = selectedSku ? publicationsBySku.get(selectedSku) || [] : [];

  function categoryFeeForProduct(product: Product) {
    return categoryFees.find((item) => item.category?.toLowerCase() === (product.category || "").toLowerCase()) || null;
  }

  function channelSetting(productId: string | undefined, optionCode: string) {
    return marginSettings.find((item) => item.product_id === productId && item.channel_code === optionCode);
  }

  function optionForPublication(publication: MercadoLibreShippingCost) {
    const count = publicationInstallments(publication);
    const byCount = pricingOptions.find((option) => Number(option.installment_count || 0) === Number(count || 0));
    if (byCount) return byCount;
    const financingRate = Number(publication.meli_financing_fee_rate || 0);
    const byRate = pricingOptions.find((option) => Math.abs(Number(option.financing_fee_rate || 0) - financingRate) < 0.05);
    return byRate || mercadoLibreClassicOption();
  }

  function offerPriceForPublication(product: Product, publication: MercadoLibreShippingCost, margin: number) {
    const option = normalizeOption(optionForPublication(publication));
    const setting = channelSetting(product.id, option.code);
    const result = calculatePriceSummary(
      product,
      option,
      option.applies_marketplace_fee ? categoryFeeForProduct(product) : null,
      taxes,
      option.applies_shipping ? publication : null,
      {
        desiredMarginRate: margin,
        desiredNetProfit: null,
        structureAmount: Number(setting?.structure_amount || 0),
        manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
        salesCommissionRate: Number(setting?.sales_commission_rate || 0),
        saleAppliesVat: setting?.sale_applies_vat ?? Boolean(option.applies_vat),
        costVatRate: Number(setting?.cost_vat_rate || 0),
        roundTo: 100,
        roundingMode: "nearest",
      },
    ) as { valid: boolean; roundedPrice?: number };
    return result.valid ? Number(result.roundedPrice || 0) : null;
  }

  function rowKey(sku: string, date: string) {
    return `${sku}|${date}`;
  }

  function addPublication(publication: MercadoLibreShippingCost) {
    if (!selectedProduct || !publication.meli_item_id) return;
    if (draftRows.length >= MAX_ROWS) {
      setError(`La lista ya tiene ${MAX_ROWS} MLA.`);
      return;
    }
    if (draftRows.some((row) => rowKey(row.sku, row.date) === rowKey(selectedProduct.sku, selectedDate))) {
      setError("Ese SKU ya esta cargado para ese dia. Elegi otro dia o borra la fila existente.");
      return;
    }
    if (draftRows.some((row) => row.itemId === publication.meli_item_id && row.date === selectedDate)) {
      setError("Ese MLA ya esta cargado para ese dia.");
      return;
    }
    const offerPrice = offerPriceForPublication(selectedProduct, publication, targetMargin);
    const salePrice = Number(publication.meli_price || 0);
    if (!offerPrice || !salePrice) {
      setError("No pude calcular precio oferta o falta el precio actual de MercadoLibre.");
      return;
    }
    setDraftRows((current) => [
      ...current,
      {
        id: `${publication.meli_item_id}-${selectedDate}-${Date.now()}`,
        accountName: ACCOUNT_NAME,
        date: selectedDate,
        sku: selectedProduct.sku,
        productName: selectedProduct.name,
        itemId: publication.meli_item_id || "",
        itemTitle: publication.meli_title || selectedProduct.name,
        installmentLabel: optionLabelForPublication(publication),
        salePrice,
        offerPrice,
        targetMargin,
      },
    ]);
    setError(null);
  }

  const sheetRows = useMemo(() => {
    return draftRows.map((row) => ({
      "ID DE LA CUENTA": row.accountName,
      "Fecha de inicio": formatSheetDate(row.date),
      "Fecha de Fin": formatSheetDate(row.date),
      "ID de los items MLA": itemIdWithoutPrefix(row.itemId),
      "Precio de la oferta": numberForSheet(row.offerPrice),
      "Precio PVP (precio de venta al publico)": numberForSheet(row.salePrice),
    }));
  }, [draftRows]);

  function sheetTsv() {
    const headers = [
      "ID DE LA CUENTA",
      "Fecha de inicio",
      "Fecha de Fin",
      "ID de los items MLA",
      "Precio de la oferta",
      "Precio PVP (precio de venta al publico)",
    ];
    return [
      headers.join("\t"),
      ...sheetRows.map((row) => headers.map((header) => String(row[header as keyof typeof row] ?? "")).join("\t")),
    ].join("\n");
  }

  async function copySheet() {
    await navigator.clipboard.writeText(sheetTsv());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function exportXlsx() {
    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Asesoria 360");
    XLSX.writeFile(workbook, "asesoria-360.xlsx");
  }

  return (
    <main className="container wide asesoria360-page">
      <PageHero
        title="Asesoria 360"
        description="Armado semanal de hasta 40 MLA para tarjetas nuevas de descuento."
        onRefresh={loadData}
        refreshLabel={loading ? "Actualizando..." : "Actualizar"}
        refreshDisabled={loading}
      />

      {error && <div className="message error">{error}</div>}

      <section className="card asesoria360-workspace">
        <div className="asesoria360-products">
          <div className="asesoria360-panel-head">
            <div>
              <h2>Elegir SKU</h2>
              <p>Productos activos con publicaciones MLA disponibles.</p>
            </div>
            <span className="badge">{productGroups.length}</span>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, nombre o modelo" />
          <div className="asesoria360-sku-list">
            {productGroups.map(({ product, publications: groupPublications }) => (
              <button
                key={product.sku}
                type="button"
                className={`asesoria360-sku ${selectedSku === product.sku ? "active" : ""}`}
                onClick={() => setSelectedSku(product.sku)}
              >
                <strong>{product.sku}</strong>
                <span>{product.name}</span>
                <small>{groupPublications.length} MLA</small>
              </button>
            ))}
          </div>
        </div>

        <div className="asesoria360-publications">
          <div className="asesoria360-panel-head">
            <div>
              <h2>{selectedProduct ? selectedProduct.sku : "Selecciona un SKU"}</h2>
              <p>{selectedProduct ? selectedProduct.name : "Despues elegis dia, margen y MLA."}</p>
            </div>
          </div>

          <div className="asesoria360-controls">
            <div className="field">
              <label>Dia para cargar</label>
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
            </div>
            <div className="field">
              <label>Ganancia final objetivo</label>
              <div className="asesoria360-percent-input">
                <input value={targetMargin} onChange={(event) => setTargetMargin(Number(toNumber(event.target.value) ?? 0))} />
                <span>%</span>
              </div>
            </div>
          </div>
          <div className="asesoria360-days">
            <button type="button" className="button ghost" onClick={() => setSelectedDate(nextWeekday(1))}>Lun prox.</button>
            <button type="button" className="button ghost" onClick={() => setSelectedDate(nextWeekday(2))}>Mar prox.</button>
            <button type="button" className="button ghost" onClick={() => setSelectedDate(nextWeekday(3))}>Mie prox.</button>
            <button type="button" className="button ghost" onClick={() => setSelectedDate(nextWeekday(4))}>Jue prox.</button>
            <button type="button" className="button ghost" onClick={() => setSelectedDate(nextWeekday(5))}>Vie prox.</button>
          </div>

          <div className="asesoria360-mla-list">
            {!selectedProduct && <div className="asesoria360-empty">Elegi un SKU para ver sus publicaciones.</div>}
            {selectedProduct && selectedPublications.map((publication) => {
              const offerPrice = offerPriceForPublication(selectedProduct, publication, targetMargin);
              const disabled = draftRows.some((row) => rowKey(row.sku, row.date) === rowKey(selectedProduct.sku, selectedDate));
              return (
                <article key={publication.id || publication.meli_item_id} className="asesoria360-mla-card">
                  <div>
                    <strong>{publication.meli_item_id}</strong>
                    <span>{publication.meli_title || selectedProduct.name}</span>
                    <small>{optionLabelForPublication(publication)}</small>
                  </div>
                  <div className="asesoria360-price-stack">
                    <span>Venta {moneyWithCents(publication.meli_price)}</span>
                    <strong>Oferta {moneyWithCents(offerPrice)}</strong>
                  </div>
                  <button type="button" className="button" disabled={disabled || draftRows.length >= MAX_ROWS} onClick={() => addPublication(publication)}>
                    Agregar
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card asesoria360-draft">
        <div className="asesoria360-panel-head">
          <div>
            <h2>Lista para planilla</h2>
            <p>{draftRows.length}/{MAX_ROWS} MLA cargados.</p>
          </div>
          <div className="actions">
            <button className="button ghost" type="button" onClick={copySheet} disabled={!draftRows.length}>{copied ? "Copiado" : "Copiar planilla"}</button>
            <button className="button ghost" type="button" onClick={exportXlsx} disabled={!draftRows.length}>Exportar XLSX</button>
            <button className="button danger" type="button" onClick={() => setDraftRows([])} disabled={!draftRows.length}>Borrar todo</button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Fecha inicio</th>
                <th>Fecha fin</th>
                <th>MLA</th>
                <th>SKU</th>
                <th>Cuotas</th>
                <th>Precio oferta</th>
                <th>PVP</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draftRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.accountName}</td>
                  <td>{formatSheetDate(row.date)}</td>
                  <td>{formatSheetDate(row.date)}</td>
                  <td>{itemIdWithoutPrefix(row.itemId)}</td>
                  <td><strong>{row.sku}</strong><br /><span className="small">{row.productName}</span></td>
                  <td>{row.installmentLabel}</td>
                  <td>{moneyWithCents(row.offerPrice)}<br /><span className="small">Margen {row.targetMargin}%</span></td>
                  <td>{moneyWithCents(row.salePrice)}</td>
                  <td><button className="button danger" type="button" onClick={() => setDraftRows((current) => current.filter((item) => item.id !== row.id))}>Borrar</button></td>
                </tr>
              ))}
              {!draftRows.length && (
                <tr>
                  <td colSpan={9} className="asesoria360-empty">Todavia no agregaste MLA a la lista.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
