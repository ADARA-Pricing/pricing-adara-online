import type { MercadoLibreCategoryFee, MercadoLibrePriceOption, MercadoLibreShippingCost, Product, RoundingMode, TaxSettings } from "@/lib/types";

export function money(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value);
}

export function moneyWithCents(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
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

type PricingTarget = {
  desiredMarginRate?: number;
  desiredNetProfit?: number | null;
  roundTo?: number;
  roundingMode?: RoundingMode;
};

export function calculateMercadoLibrePrice(
  product: Product,
  option: MercadoLibrePriceOption,
  categoryFee?: MercadoLibreCategoryFee | null,
  taxes: TaxSettings = defaultTaxSettings(),
  shippingCost?: MercadoLibreShippingCost | null,
  desiredProfitRate = 5,
  roundTo = 100,
  roundingMode: RoundingMode = "nearest"
) {
  return calculatePriceSummary(product, option, categoryFee, taxes, shippingCost, {
    desiredMarginRate: desiredProfitRate,
    desiredNetProfit: null,
    roundTo,
    roundingMode
  });
}

export function calculatePriceSummary(
  product: Product,
  option: MercadoLibrePriceOption,
  categoryFee?: MercadoLibreCategoryFee | null,
  taxes: TaxSettings = defaultTaxSettings(),
  shippingCost?: MercadoLibreShippingCost | null,
  target: PricingTarget = {}
) {
  const costWithoutVat = Number(product.cost_without_vat || 0);
  const productVatRate = Number(product.vat_rate || 21);
  const marketplaceFeeRate = Number(categoryFee?.marketplace_fee_rate || 0);
  const financingFeeRate = Number(option.financing_fee_rate || 0);
  const marginRate = Number(target.desiredMarginRate ?? 5);
  const desiredNetProfit = target.desiredNetProfit ?? null;
  const fixedFeeAmount = Number(shippingCost?.fixed_fee_amount || 0);
  const shippingCostAmount = Number(shippingCost?.shipping_cost_amount || 0);
  const fixedCosts = fixedFeeAmount + shippingCostAmount;
  const roundTo = target.roundTo ?? 100;
  const roundingMode = target.roundingMode ?? "nearest";

  const iibbRate = Number(taxes.iibb_rate || 0);
  const idcRate = Number(taxes.idc_rate || 0);
  const iiggRate = Number(taxes.iigg_rate || 0);
  const structureRate = Number(taxes.structure_rate || 0);
  const taxesRate = iibbRate + idcRate + iiggRate + structureRate;
  const saleCostRate = marketplaceFeeRate + financingFeeRate + taxesRate;

  let netSalePrice: number;
  let effectiveMarginRate = marginRate;

  if (desiredNetProfit !== null && Number.isFinite(Number(desiredNetProfit))) {
    const denominator = 1 - rateToDecimal(saleCostRate);
    if (denominator <= 0) return invalidResult("La suma de comisión, cuotas e impuestos llega o supera el 100%.", { marketplaceFeeRate, financingFeeRate, marginRate, taxesRate, fixedFeeAmount, shippingCostAmount, fixedCosts, variableRate: saleCostRate });
    netSalePrice = (costWithoutVat + fixedCosts + Number(desiredNetProfit)) / denominator;
    effectiveMarginRate = netSalePrice > 0 ? (Number(desiredNetProfit) / netSalePrice) * 100 : 0;
  } else {
    const variableRate = saleCostRate + marginRate;
    const denominator = 1 - rateToDecimal(variableRate);
    if (denominator <= 0) return invalidResult("La suma de margen, comisión, cuotas e impuestos llega o supera el 100%.", { marketplaceFeeRate, financingFeeRate, marginRate, taxesRate, fixedFeeAmount, shippingCostAmount, fixedCosts, variableRate });
    netSalePrice = (costWithoutVat + fixedCosts) / denominator;
  }

  const price = netSalePrice * (1 + productVatRate / 100);
  const roundedPrice = roundPrice(price, roundTo, roundingMode);
  const roundedNetSalePrice = roundedPrice / (1 + productVatRate / 100);

  const vatAmount = roundedPrice - roundedNetSalePrice;
  const marketplaceFeeAmount = roundedNetSalePrice * rateToDecimal(marketplaceFeeRate + financingFeeRate);
  const iibbAmount = roundedNetSalePrice * rateToDecimal(iibbRate);
  const idcAmount = roundedNetSalePrice * rateToDecimal(idcRate);
  const structureAmount = roundedNetSalePrice * rateToDecimal(structureRate);
  const grossProfit = roundedNetSalePrice - costWithoutVat - fixedCosts - marketplaceFeeAmount - iibbAmount - idcAmount - structureAmount;
  const incomeTaxAmount = roundedNetSalePrice * rateToDecimal(iiggRate);
  const netProfit = grossProfit - incomeTaxAmount;
  const marginOnCost = costWithoutVat > 0 ? (netProfit / costWithoutVat) * 100 : 0;
  const marginOnNetSale = roundedNetSalePrice > 0 ? (netProfit / roundedNetSalePrice) * 100 : 0;
  const variableRate = saleCostRate + effectiveMarginRate;

  return {
    valid: true,
    price,
    roundedPrice,
    netSalePrice: roundedNetSalePrice,
    vatAmount,
    marketplaceFeeAmount,
    iibbAmount,
    idcAmount,
    structureAmount,
    grossProfit,
    incomeTaxAmount,
    netProfit,
    marginOnCost,
    marginOnNetSale,
    marketplaceFeeRate,
    financingFeeRate,
    marginRate: effectiveMarginRate,
    desiredNetProfit: desiredNetProfit ?? netProfit,
    taxesRate,
    iibbRate,
    idcRate,
    iiggRate,
    structureRate,
    fixedFeeAmount,
    shippingCostAmount,
    fixedCosts,
    variableRate,
    error: null
  };
}

function invalidResult(message: string, values: Record<string, number>) {
  return {
    valid: false,
    price: null,
    roundedPrice: null,
    netSalePrice: null,
    vatAmount: null,
    marketplaceFeeAmount: null,
    iibbAmount: null,
    idcAmount: null,
    structureAmount: null,
    grossProfit: null,
    incomeTaxAmount: null,
    netProfit: null,
    marginOnCost: null,
    marginOnNetSale: null,
    desiredNetProfit: null,
    ...values,
    error: message
  };
}
