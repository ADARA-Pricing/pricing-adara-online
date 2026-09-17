"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Package } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { moneyWithCents, percent, toNumber } from "@/lib/pricing";
import type { MercadoLibreCategoryFee, MercadoLibreShippingCost, Product, TaxSettings } from "@/lib/types";

const emptyTaxes: Pick<TaxSettings, "iibb_rate" | "idc_rate" | "iigg_rate"> = { iibb_rate: 0, idc_rate: 0, iigg_rate: 0 };

export default function MobileCalculatorPage() {
  const supabase = createClient();
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [commission, setCommission] = useState("15");
  const [shipping, setShipping] = useState("0");
  const [fixedFee, setFixedFee] = useState("0");
  const [taxes, setTaxes] = useState(emptyTaxes);
  const [products, setProducts] = useState<Product[]>([]);
  const [shippingCosts, setShippingCosts] = useState<MercadoLibreShippingCost[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("tax_settings").select("iibb_rate,idc_rate,iigg_rate").eq("key", "default").maybeSingle(),
      supabase.from("products").select("*").eq("status", "active").order("name"),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
    ]).then(([taxResponse, productsResponse, shippingResponse, feesResponse]) => {
      if (taxResponse.data) setTaxes(taxResponse.data);
      setProducts((productsResponse.data || []) as Product[]);
      setShippingCosts((shippingResponse.data || []) as MercadoLibreShippingCost[]);
      setCategoryFees((feesResponse.data || []) as MercadoLibreCategoryFee[]);
    });
  }, []);

  function loadProduct(productId: string) {
    setSelectedProductId(productId);
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    const publications = shippingCosts.filter((item) => item.product_id === product.id || item.sku === product.sku);
    const average = (field: "shipping_cost_amount" | "fixed_fee_amount") => publications.length ? publications.reduce((sum, item) => sum + Number(item[field] || 0), 0) / publications.length : 0;
    const fee = categoryFees.find((item) => item.category.trim().toLowerCase() === (product.category || "").trim().toLowerCase());
    setCost(String(Math.round(Number(product.cost_without_vat || 0))));
    setCommission(String(Number(fee?.marketplace_fee_rate || 0)));
    setShipping(String(Math.round(average("shipping_cost_amount"))));
    setFixedFee(String(Math.round(average("fixed_fee_amount"))));
    setProductQuery(`${product.sku} · ${product.name}`);
    setProductPickerOpen(false);
  }

  const matchingProducts = useMemo(() => {
    const query = productQuery.trim().toLocaleLowerCase("es-AR");
    if (!query) return products.slice(0, 6);
    return products.filter((product) => `${product.sku} ${product.name} ${product.category || ""}`.toLocaleLowerCase("es-AR").includes(query)).slice(0, 7);
  }, [products, productQuery]);

  const result = useMemo(() => {
    const grossPrice = Number(toNumber(price) || 0);
    const netSale = grossPrice / 1.21;
    const productCost = Number(toNumber(cost) || 0);
    const marketplaceFee = grossPrice * Number(toNumber(commission) || 0) / 100 / 1.21;
    const shippingCost = Number(toNumber(shipping) || 0) / 1.21;
    const fixedCost = Number(toNumber(fixedFee) || 0) / 1.21;
    const salesTaxes = netSale * (Number(taxes.iibb_rate || 0) + Number(taxes.idc_rate || 0)) / 100;
    const beforeIncomeTax = netSale - productCost - marketplaceFee - shippingCost - fixedCost - salesTaxes;
    const incomeTax = Math.max(beforeIncomeTax, 0) * Number(taxes.iigg_rate || 0) / 100;
    const profit = beforeIncomeTax - incomeTax;
    return { grossPrice, netSale, marketplaceFee, shippingCost, fixedCost, salesTaxes, profit, margin: netSale > 0 ? profit / netSale * 100 : 0 };
  }, [cost, price, commission, shipping, fixedFee, taxes]);

  return <main className="mobile-calculator-page">
    <header className="mobile-calculator-header"><img src="/adara-mark.png" alt="ADARA" /><div><span>ADARA</span><h1>Calculadora rápida</h1></div></header>
    <section className="mobile-calculator-card">
      <div className="mobile-calculator-card-title"><Calculator aria-hidden="true" /><div><h2>Simular venta ML</h2><p>Estimación rápida con los impuestos configurados.</p></div></div>
      <label>Producto cargado
        <div className="mobile-calculator-product-picker">
          <input value={productQuery} onFocus={() => setProductPickerOpen(true)} onChange={(event) => { setProductQuery(event.target.value); setProductPickerOpen(true); setSelectedProductId(""); }} placeholder="Buscar por SKU o nombre" />
          {productPickerOpen && <div className="mobile-calculator-product-options">
            {matchingProducts.map((product) => <button type="button" key={product.id} onClick={() => loadProduct(product.id)}><strong>{product.sku}</strong><span>{product.name}</span></button>)}
            {!matchingProducts.length && <p>No hay productos que coincidan.</p>}
          </div>}
        </div>
        <small>Completa costo, comisión, envío y costo fijo desde tus datos.</small>
      </label>
      <label>Costo sin IVA<input inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="$ 0" /></label>
      <label>Precio de venta c/IVA<input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="$ 0" /></label>
      <label>Comisión ML <span>%</span><input inputMode="decimal" value={commission} onChange={(event) => setCommission(event.target.value)} /></label>
      <div className="mobile-calculator-two"><label>Envío c/IVA<input inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} /></label><label>Costo fijo c/IVA<input inputMode="decimal" value={fixedFee} onChange={(event) => setFixedFee(event.target.value)} /></label></div>
    </section>
    <section className={`mobile-calculator-result ${result.profit < 0 ? "negative" : ""}`}><span>Ganancia estimada</span><strong>{moneyWithCents(result.profit)}</strong><b>{percent(result.margin)}</b><div><span>Venta neta <em>{moneyWithCents(result.netSale)}</em></span><span>Comisión <em>{moneyWithCents(result.marketplaceFee)}</em></span><span>Envío <em>{moneyWithCents(result.shippingCost)}</em></span><span>Costos fijos <em>{moneyWithCents(result.fixedCost + result.salesTaxes)}</em></span></div></section>
  </main>;
}
