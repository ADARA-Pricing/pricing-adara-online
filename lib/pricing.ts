import type { MercadoLibreCategoryFee, MercadoLibrePriceOption, MercadoLibreShippingCost, Product, RoundingMode, TaxSettings } from "@/lib/types";

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

export function roundPrice(value: number, roundTo: number, mode: RoundingMode) {
  const step = Math.max(1, Number(roundTo || 1));
  if (mode === "up") return Math.ceil(value / step) * step;
  if (mode === "down") return Math.floor(value / step) * step;
  return Math.round(value / step) * step;
}

export function defaultTaxSettings(): TaxSettings {
  return { key: "default", iibb_rate: 0, idc_rate: 0, iigg_rate: 0, structure_rate: 0, notes: "" };
}

export function mercadoLibreClassicOption(): MercadoLibrePriceOption {
  return { code: "MC", name: "MercadoLibre Clásica", installment_count: null, financing_fee_rate: 0, active: true };
}

export function calculateMercadoLibrePrice(
  product: Product,
  option: MercadoLibrePriceOption,
  categoryFee?: MercadoLibreCategoryFee | null,
  taxes: TaxSettings = defaultTaxSettings(),
  shippingCost?: MercadoLibreShippingCost | null,
  desiredProfitRate = 10,
  roundTo = 100,
  roundingMode: RoundingMode = "nearest"
) {
  const costWithoutVat = Number(product.cost_without_vat || 0);
  const productVatRate = Number(product.vat_rate || 21);
  const marketplaceFeeRate = Number(categoryFee?.marketplace_fee_rate || 0);
  const financingFeeRate = Number(option.financing_fee_rate || 0);
  const marginRate = Number(desiredProfitRate || 0);
  const fixedFeeAmount = Number(shippingCost?.fixed_fee_amount || 0);
  const shippingCostAmount = Number(shippingCost?.shipping_cost_amount || 0);
  const fixedCosts = fixedFeeAmount + shippingCostAmount;

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
      fixedFeeAmount,
      shippingCostAmount,
      fixedCosts,
      variableRate,
      error: "La suma de ganancia, comisión, cuotas e impuestos llega o supera el 100%."
    };
  }

  const netSalePrice = (costWithoutVat + fixedCosts) / denominator;
  const price = netSalePrice * (1 + productVatRate / 100);
  const roundedPrice = roundPrice(price, roundTo, roundingMode);
  const roundedNetSalePrice = roundedPrice / (1 + productVatRate / 100);

  const realVariableCostWithoutMargin = roundedNetSalePrice * rateToDecimal(marketplaceFeeRate + financingFeeRate + taxesRate);
  const netProfit = roundedNetSalePrice - costWithoutVat - fixedCosts - realVariableCostWithoutMargin;
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
    fixedFeeAmount,
    shippingCostAmount,
    fixedCosts,
    variableRate,
    error: null
  };
}
