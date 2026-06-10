import type {
  MercadoLibreCategoryFee,
  MercadoLibrePriceOption,
  MercadoLibreShippingCost,
  Product,
  RoundingMode,
  TaxSettings,
} from "./types";

export function money(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function moneyWithCents(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function percent(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `${Number(value).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
}

export function promoListPrice(
  finalPrice?: number | null,
  discountRate?: number | null,
) {
  const price = Number(finalPrice || 0);
  const discount = Number(discountRate || 0);
  if (!price || !Number.isFinite(price) || discount <= 0) return null;
  if (discount >= 100) return null;
  return price / (1 - discount / 100);
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
  return {
    key: "default",
    iibb_rate: 0,
    idc_rate: 0,
    iigg_rate: 0,
    structure_rate: 0,
    notes: "",
  };
}

export function mercadoLibreClassicOption(): MercadoLibrePriceOption {
  return {
    code: "MC",
    name: "MercadoLibre Clásica",
    channel_type: "mercadolibre",
    installment_count: null,
    financing_fee_rate: 0,
    applies_marketplace_fee: true,
    applies_shipping: true,
    applies_iibb: true,
    applies_idc: true,
    applies_iigg: true,
    applies_structure: true,
    applies_vat: true,
    active: true,
  };
}

type PricingTarget = {
  desiredMarginRate?: number;
  desiredNetProfit?: number | null;
  salePrice?: number | null;
  structureAmount?: number | null;
  manualShippingAmount?: number | null;
  salesCommissionRate?: number | null;
  saleAppliesVat?: boolean | null;
  costVatRate?: number | null;
  roundTo?: number;
  roundingMode?: RoundingMode;
};

function defaultTrue(value: boolean | null | undefined) {
  return value !== false;
}

function defaultFalse(value: boolean | null | undefined) {
  return value === true;
}

export function normalizeOption(
  option: MercadoLibrePriceOption,
): MercadoLibrePriceOption {
  const channelType =
    option.channel_type ||
    (option.code?.startsWith("MP") || option.code === "MC"
      ? "mercadolibre"
      : "directo");
  const isMl =
    channelType === "mercadolibre" ||
    option.code === "MC" ||
    option.code?.startsWith("MP");

  return {
    ...option,
    channel_type: channelType,
    financing_fee_rate: Number(option.financing_fee_rate || 0),
    applies_marketplace_fee: isMl
      ? defaultTrue(option.applies_marketplace_fee)
      : defaultFalse(option.applies_marketplace_fee),
    applies_shipping: isMl
      ? defaultTrue(option.applies_shipping)
      : defaultFalse(option.applies_shipping),
    applies_iibb: isMl
      ? defaultTrue(option.applies_iibb)
      : defaultFalse(option.applies_iibb),
    applies_idc: isMl
      ? defaultTrue(option.applies_idc)
      : defaultFalse(option.applies_idc),
    applies_iigg: isMl
      ? defaultTrue(option.applies_iigg)
      : defaultFalse(option.applies_iigg),
    applies_structure: isMl
      ? defaultTrue(option.applies_structure)
      : defaultFalse(option.applies_structure),
    applies_vat: isMl
      ? defaultTrue(option.applies_vat)
      : defaultFalse(option.applies_vat),
  };
}

export function calculateMercadoLibrePrice(
  product: Product,
  option: MercadoLibrePriceOption,
  categoryFee?: MercadoLibreCategoryFee | null,
  taxes: TaxSettings = defaultTaxSettings(),
  shippingCost?: MercadoLibreShippingCost | null,
  desiredProfitRate = 5,
  roundTo = 100,
  roundingMode: RoundingMode = "nearest",
) {
  return calculatePriceSummary(
    product,
    option,
    categoryFee,
    taxes,
    shippingCost,
    {
      desiredMarginRate: desiredProfitRate,
      desiredNetProfit: null,
      roundTo,
      roundingMode,
    },
  );
}

export function calculatePriceSummary(
  product: Product,
  rawOption: MercadoLibrePriceOption,
  categoryFee?: MercadoLibreCategoryFee | null,
  taxes: TaxSettings = defaultTaxSettings(),
  shippingCost?: MercadoLibreShippingCost | null,
  target: PricingTarget = {},
) {
  const option = normalizeOption(rawOption);
  const costWithoutVat = Number(product.cost_without_vat || 0);
  const productVatRate = Number(product.vat_rate || 21);
  const appliesVat = target.saleAppliesVat ?? option.applies_vat;
  const saleVatRate = appliesVat ? productVatRate : 0;
  const rawCostVatRate = Number(target.costVatRate ?? 0);
  const costVatRate = Math.max(0, Math.min(productVatRate, rawCostVatRate));
  const costVatAmount = costWithoutVat * rateToDecimal(costVatRate);
  const costForProfit = costWithoutVat + costVatAmount;
  const marketplaceFeeRate = option.applies_marketplace_fee
    ? Number(categoryFee?.marketplace_fee_rate || 0)
    : 0;
  const financingFeeRate = Number(option.financing_fee_rate || 0);
  const marginRate = Number(target.desiredMarginRate ?? 5);
  const desiredNetProfit = target.desiredNetProfit ?? null;

  const roundTo = target.roundTo ?? 100;
  const roundingMode = target.roundingMode ?? "nearest";

  const iibbRate = option.applies_iibb ? Number(taxes.iibb_rate || 0) : 0;
  const idcRate = option.applies_idc ? Number(taxes.idc_rate || 0) : 0;
  const iiggRate = option.applies_iigg ? Number(taxes.iigg_rate || 0) : 0;
  const structureAmount = option.applies_structure
    ? Number(target.structureAmount || 0)
    : 0;
  const salesCommissionRate = option.applies_marketplace_fee
    ? 0
    : Number(target.salesCommissionRate || 0);

  const fixedFeeAmount = Number(shippingCost?.fixed_fee_amount || 0);
  const shippingCostAmountGross = option.applies_shipping
    ? Number(shippingCost?.shipping_cost_amount || 0)
    : 0;
  const shippingCostAmount = option.applies_shipping
    ? shippingCostAmountGross / 1.21
    : Number(target.manualShippingAmount || 0);
  const manualShippingAmount = option.applies_shipping ? 0 : shippingCostAmount;
  const fixedCosts = fixedFeeAmount + shippingCostAmount + structureAmount;
  const salesTaxRate = iibbRate + idcRate;
  const iiggDecimal = rateToDecimal(iiggRate);
  const channelFeeRate = marketplaceFeeRate + financingFeeRate;

  // Comisiones/costos de canal cargados como porcentaje sobre precio de venta con IVA.
  // Si están facturados con IVA 21%, para rentabilidad usamos el neto: precio bruto * % / 1,21.
  // Expresado sobre precio sin IVA de la venta, el factor cambia según si la venta lleva IVA o no.
  const channelFeeRateOnNetSale =
    ((1 + saleVatRate / 100) / 1.21) * channelFeeRate;
  const salesCommissionRateOnNetSale =
    (1 + saleVatRate / 100) * salesCommissionRate;
  const saleCostRate =
    channelFeeRateOnNetSale + salesTaxRate + salesCommissionRateOnNetSale;

  let netSalePrice: number;
  let price: number;
  let roundedPrice: number;
  let effectiveMarginRate = marginRate;
  const explicitSalePrice = target.salePrice ?? null;

  if (iiggDecimal >= 1) {
    return invalidResult(
      "Impuesto a las ganancias no puede ser 100% o mayor.",
      {
        marketplaceFeeRate,
        financingFeeRate,
        marginRate,
        salesTaxRate,
        iiggRate,
        fixedFeeAmount,
        shippingCostAmount,
        shippingCostAmountGross,
        fixedCosts,
        variableRate: saleCostRate,
      },
    );
  }

  if (
    explicitSalePrice !== null &&
    Number.isFinite(Number(explicitSalePrice)) &&
    Number(explicitSalePrice) > 0
  ) {
    price = Number(explicitSalePrice);
    roundedPrice = price;
    netSalePrice = price / (1 + saleVatRate / 100);
  } else if (
    desiredNetProfit !== null &&
    Number.isFinite(Number(desiredNetProfit))
  ) {
    const denominator = 1 - rateToDecimal(saleCostRate);
    if (denominator <= 0)
      return invalidResult(
        "La suma de comisión, cuotas e impuestos de venta llega o supera el 100%.",
        {
          marketplaceFeeRate,
          financingFeeRate,
          marginRate,
          salesTaxRate,
          iiggRate,
          fixedFeeAmount,
          shippingCostAmount,
          shippingCostAmountGross,
          fixedCosts,
          variableRate: saleCostRate,
        },
      );
    const requiredGrossProfit = Number(desiredNetProfit) / (1 - iiggDecimal);
    netSalePrice =
      (costForProfit + fixedCosts + requiredGrossProfit) / denominator;
    effectiveMarginRate =
      netSalePrice > 0 ? (Number(desiredNetProfit) / netSalePrice) * 100 : 0;
    price = netSalePrice * (1 + saleVatRate / 100);
    roundedPrice = roundPrice(price, roundTo, roundingMode);
  } else {
    const desiredNetMarginDecimal = rateToDecimal(marginRate);
    const denominator =
      1 -
      rateToDecimal(saleCostRate) -
      desiredNetMarginDecimal / (1 - iiggDecimal);
    if (denominator <= 0)
      return invalidResult(
        "La suma de margen, comisión, cuotas e impuestos de venta llega o supera el 100%.",
        {
          marketplaceFeeRate,
          financingFeeRate,
          marginRate,
          salesTaxRate,
          iiggRate,
          fixedFeeAmount,
          shippingCostAmount,
          shippingCostAmountGross,
          fixedCosts,
          variableRate: saleCostRate + marginRate,
        },
      );
    netSalePrice = (costForProfit + fixedCosts) / denominator;
    price = netSalePrice * (1 + saleVatRate / 100);
    roundedPrice = roundPrice(price, roundTo, roundingMode);
  }

  const roundedNetSalePrice = roundedPrice / (1 + saleVatRate / 100);

  const vatAmount = roundedPrice - roundedNetSalePrice;
  const marketplaceFeeAmount =
    (roundedPrice * rateToDecimal(channelFeeRate)) / 1.21;
  const salesCommissionAmount =
    roundedPrice * rateToDecimal(salesCommissionRate);
  const iibbAmount = roundedNetSalePrice * rateToDecimal(iibbRate);
  const idcAmount = roundedNetSalePrice * rateToDecimal(idcRate);
  const grossProfit =
    roundedNetSalePrice -
    costForProfit -
    fixedCosts -
    marketplaceFeeAmount -
    salesCommissionAmount -
    iibbAmount -
    idcAmount;
  const incomeTaxAmount = Math.max(grossProfit, 0) * rateToDecimal(iiggRate);
  const netProfit = grossProfit - incomeTaxAmount;
  const marginOnCost =
    costForProfit > 0 ? (netProfit / costForProfit) * 100 : 0;
  const marginOnNetSale =
    roundedNetSalePrice > 0 ? (netProfit / roundedNetSalePrice) * 100 : 0;
  if (
    explicitSalePrice !== null &&
    Number.isFinite(Number(explicitSalePrice)) &&
    Number(explicitSalePrice) > 0
  ) {
    effectiveMarginRate = marginOnNetSale;
  }
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
    grossProfit,
    incomeTaxAmount,
    netProfit,
    marginOnCost,
    marginOnNetSale,
    marketplaceFeeRate,
    financingFeeRate,
    marginRate: effectiveMarginRate,
    desiredNetProfit: desiredNetProfit ?? netProfit,
    taxesRate: salesTaxRate + iiggRate,
    salesTaxRate,
    iibbRate,
    idcRate,
    iiggRate,
    structureRate: 0,
    structureAmount,
    costVatRate,
    costVatAmount,
    costForProfit,
    salesCommissionRate,
    salesCommissionAmount,
    fixedFeeAmount,
    shippingCostAmount,
    shippingCostAmountGross,
    manualShippingAmount,
    fixedCosts,
    saleVatRate,
    appliesVat: Boolean(appliesVat),
    appliesMarketplaceFee: Boolean(option.applies_marketplace_fee),
    appliesShipping: Boolean(option.applies_shipping),
    variableRate,
    error: null,
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
    salesCommissionAmount: null,
    iibbAmount: null,
    idcAmount: null,
    structureAmount: null,
    costVatRate: null,
    costVatAmount: null,
    costForProfit: null,
    grossProfit: null,
    incomeTaxAmount: null,
    netProfit: null,
    marginOnCost: null,
    marginOnNetSale: null,
    desiredNetProfit: null,
    ...values,
    error: message,
  };
}
