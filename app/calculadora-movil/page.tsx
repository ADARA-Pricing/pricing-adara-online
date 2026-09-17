"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Package, Percent, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { moneyWithCents, percent, toNumber } from "@/lib/pricing";
import type { TaxSettings } from "@/lib/types";

const emptyTaxes: Pick<TaxSettings, "iibb_rate" | "idc_rate" | "iigg_rate"> = { iibb_rate: 0, idc_rate: 0, iigg_rate: 0 };

export default function MobileCalculatorPage() {
  const supabase = createClient();
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [commission, setCommission] = useState("15");
  const [shipping, setShipping] = useState("0");
  const [fixedFee, setFixedFee] = useState("0");
  const [shippingPayer, setShippingPayer] = useState<"seller" | "customer">("seller");
  const [taxes, setTaxes] = useState(emptyTaxes);

  useEffect(() => { supabase.from("tax_settings").select("iibb_rate,idc_rate,iigg_rate").eq("key", "default").maybeSingle().then(({ data }) => { if (data) setTaxes(data); }); }, []);

  const result = useMemo(() => {
    const grossPrice = Number(toNumber(price) || 0);
    const netSale = grossPrice / 1.21;
    const productCost = Number(toNumber(cost) || 0);
    const marketplaceFee = grossPrice * Number(toNumber(commission) || 0) / 100 / 1.21;
    const shippingCost = shippingPayer === "seller" ? Number(toNumber(shipping) || 0) / 1.21 : 0;
    const fixedCost = Number(toNumber(fixedFee) || 0) / 1.21;
    const salesTaxes = netSale * (Number(taxes.iibb_rate || 0) + Number(taxes.idc_rate || 0)) / 100;
    const beforeIncomeTax = netSale - productCost - marketplaceFee - shippingCost - fixedCost - salesTaxes;
    const incomeTax = Math.max(beforeIncomeTax, 0) * Number(taxes.iigg_rate || 0) / 100;
    const profit = beforeIncomeTax - incomeTax;
    return { grossPrice, netSale, marketplaceFee, shippingCost, fixedCost, salesTaxes, profit, margin: netSale > 0 ? profit / netSale * 100 : 0 };
  }, [cost, price, commission, shipping, fixedFee, shippingPayer, taxes]);

  return <main className="mobile-calculator-page">
    <header className="mobile-calculator-header"><img src="/adara-mark.png" alt="ADARA" /><div><span>ADARA</span><h1>Calculadora rápida</h1></div></header>
    <section className="mobile-calculator-card">
      <div className="mobile-calculator-card-title"><Calculator aria-hidden="true" /><div><h2>Simular venta ML</h2><p>Estimación rápida con los impuestos configurados.</p></div></div>
      <label>Costo sin IVA<input inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="$ 0" /></label>
      <label>Precio de venta c/IVA<input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="$ 0" /></label>
      <label>Comisión ML <span>%</span><input inputMode="decimal" value={commission} onChange={(event) => setCommission(event.target.value)} /></label>
      <div className="mobile-calculator-two"><label>Envío c/IVA<input inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} /></label><label>Costo fijo c/IVA<input inputMode="decimal" value={fixedFee} onChange={(event) => setFixedFee(event.target.value)} /></label></div>
      <label>Quién paga el envío<select value={shippingPayer} onChange={(event) => setShippingPayer(event.target.value as "seller" | "customer")}><option value="seller">Lo absorbo yo</option><option value="customer">Lo paga el cliente</option></select></label>
    </section>
    <section className={`mobile-calculator-result ${result.profit < 0 ? "negative" : ""}`}><span>Ganancia estimada</span><strong>{moneyWithCents(result.profit)}</strong><b>{percent(result.margin)}</b><div><span>Venta neta <em>{moneyWithCents(result.netSale)}</em></span><span>Comisión <em>{moneyWithCents(result.marketplaceFee)}</em></span><span>Envío <em>{shippingPayer === "seller" ? moneyWithCents(result.shippingCost) : "Cliente"}</em></span><span>Costos fijos <em>{moneyWithCents(result.fixedCost + result.salesTaxes)}</em></span></div></section>
  </main>;
}
