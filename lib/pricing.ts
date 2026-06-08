import type { MercadoLibreCategoryFee, MercadoLibreInstallmentFee, Product, TaxSettings } from "@/lib/types";

export function money(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value);
}

export function percent(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `${Number(value).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
}

export function toNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rateToDecimal(rate?: number | null) {
  return Number(rate || 0) / 100;
}

export function roundPrice(value: number, roundTo: number, mode: "nearest" | "up" | "down") {
  const step = Math.max(1, Number(roundTo || 1));
  if (mode === "up") return Math.ceil(value / step) * step;
  if (mode === "down") return Math.floor(value / step) * step;
  return Math.round(value / step) * step;
}

export function defaultTaxSettings(): TaxSettings {
  return { key: "default", iibb_rate: 0, idc_rate: 0, iigg_rate: 0, structure_rate: 0, notes: "" };
}

export function calculateMercadoLibrePrice(
  product: Product,
  installment: MercadoLibreInstallmentFee,
  categoryFee?: MercadoLibreCategoryFee | null,
  taxes: TaxSettings = defaultTaxSettings()
) {
  const costWithoutVat = Number(product.cost_without_vat || 0);
  const productVatRate = Number(product.vat_rate || 21);
  const marketplaceFeeRate = Number(categoryFee?.marketplace_fee_rate || 0);
  const financingFeeRate = Number(installment.financing_fee_rate || 0);
  const marginRate = Number(installment.default_margin_rate || 0);

  const taxesRate =
    Number(taxes.iibb_rate || 0) +
    Number(taxes.idc_rate || 0) +
    Number(taxes.iigg_rate || 0) +
    Number(taxes.structure_rate || 0);

  const variableRate = marginRate + marketplaceFeeRate + financingFeeRate + taxesRate;
  const denominator = 1 - rateToDecimal(variableRate);

  if (denominator <= 0) {
    return {
      valid: false,
      price: null,
      roundedPrice: null,
      netProfit: null,
      marginOnCost: null,
      marginOnNetSale: null,
      marketplaceFeeRate,
      financingFeeRate,
      marginRate,
      taxesRate,
      variableRate,
      error: "La suma de ganancia, comisión, cuotas e impuestos llega o supera el 100%."
    };
  }

  const netSalePrice = costWithoutVat / denominator;
  const price = netSalePrice * (1 + productVatRate / 100);
  const roundedPrice = roundPrice(price, installment.round_to || 100, installment.rounding_mode || "nearest");
  const roundedNetSalePrice = roundedPrice / (1 + productVatRate / 100);

  const realVariableCostWithoutMargin = roundedNetSalePrice * rateToDecimal(marketplaceFeeRate + financingFeeRate + taxesRate);
  const netProfit = roundedNetSalePrice - costWithoutVat - realVariableCostWithoutMargin;
  const marginOnCost = costWithoutVat > 0 ? (netProfit / costWithoutVat) * 100 : 0;
  const marginOnNetSale = roundedNetSalePrice > 0 ? (netProfit / roundedNetSalePrice) * 100 : 0;

  return {
    valid: true,
    price,
    roundedPrice,
    netProfit,
    marginOnCost,
    marginOnNetSale,
    marketplaceFeeRate,
    financingFeeRate,
    marginRate,
    taxesRate,
    variableRate,
    error: null
  };
}
