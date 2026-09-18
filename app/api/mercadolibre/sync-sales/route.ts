import { NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";
import {
  calculatePriceSummary,
  defaultTaxSettings,
  mercadoLibreClassicOption,
} from "@/lib/pricing";
import { createAdminClient } from "@/lib/supabaseAdmin";
import type {
  MercadoLibreCategoryFee,
  MercadoLibreShippingCost,
  Product,
  ProductChannelMargin,
  TaxSettings,
  FlexShippingRate,
} from "@/lib/types";

type MeliOrderItem = {
  item?: {
    id?: string;
    title?: string;
    seller_sku?: string | null;
    variation_id?: string | number | null;
  };
  quantity?: number;
  unit_price?: number;
  currency_id?: string | null;
  sale_fee?: number | null;
  listing_type_id?: string | null;
  gross_price?: number | null;
};

type MeliOrder = {
  id?: string | number;
  date_created?: string;
  status?: string | null;
  pack_id?: string | number | null;
  shipping?: { id?: string | number | null } | null;
  order_items?: MeliOrderItem[];
  payments?: Array<{
    installments?: number | null;
    payment_method_id?: string | null;
  }>;
};

type MeliShipment = {
  id?: string | number | null;
  mode?: string | null;
  logistic_type?: string | null;
  receiver_address?: { state?: { name?: string | null } | null; city?: { name?: string | null } | null } | null;
};

type MeliShipmentCosts = {
  senders?: Array<{
    cost?: number | null;
    charges?: { charge_flex?: number | null } | null;
    discounts?: Array<{ promoted_amount?: number | null }> | null;
  }> | null;
};

type MeliItemCatalogLink = {
  catalog_product_id?: string | null;
};

type ProductCostHistory = {
  product_id: string;
  sku: string | null;
  previous_cost_without_vat: number | null;
  new_cost_without_vat: number | null;
  previous_vat_rate: number | null;
  new_vat_rate: number | null;
  changed_at: string;
};

function normalizeSku(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function asString(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function mapBySku<T extends { sku?: string | null }>(items: T[]) {
  const map = new Map<string, T>();
  items.forEach((item) => {
    const sku = normalizeSku(item.sku);
    if (sku) map.set(sku, item);
  });
  return map;
}

function marginKey(productId: string | undefined | null, channelCode: string) {
  return `${productId || ""}|${channelCode}`;
}

function categoryFeeForProduct(product: Pick<Product, "category">, fees: MercadoLibreCategoryFee[]) {
  return fees.find((item) => item.active && item.category?.toLowerCase() === (product.category || "").toLowerCase()) || null;
}

function productWithCostAtDate(
  product: Product | null,
  orderDate: string,
  historiesByProductId: Map<string, ProductCostHistory[]>,
  historiesBySku: Map<string, ProductCostHistory[]>,
) {
  if (!product) return null;
  const target = new Date(orderDate).getTime();
  if (!Number.isFinite(target)) return product;
  const histories = [
    ...(product.id ? historiesByProductId.get(String(product.id)) || [] : []),
    ...(historiesBySku.get(normalizeSku(product.sku)) || []),
  ];
  if (!histories.length) return product;

  const before = [...histories]
    .filter((history) => new Date(history.changed_at).getTime() <= target)
    .sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime())[0];
  const after = [...histories]
    .filter((history) => new Date(history.changed_at).getTime() > target)
    .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())[0];
  const source = before
    ? { cost: before.new_cost_without_vat, vat: before.new_vat_rate }
    : after
      ? {
        cost: Number(after.previous_cost_without_vat || 0) > 0 ? after.previous_cost_without_vat : after.new_cost_without_vat,
        vat: Number(after.previous_cost_without_vat || 0) > 0 ? after.previous_vat_rate : after.new_vat_rate,
      }
      : null;
  if (!source) return product;

  return {
    ...product,
    cost_without_vat: Number(source.cost ?? product.cost_without_vat ?? 0),
    vat_rate: Number(source.vat ?? product.vat_rate ?? 21) as Product["vat_rate"],
  };
}

type SalesPublication = Pick<
  MercadoLibreShippingCost,
  | "product_id"
  | "sku"
  | "meli_item_id"
  | "meli_title"
  | "fixed_fee_amount"
  | "shipping_cost_amount"
  | "free_shipping"
  | "meli_price"
  | "meli_promo_price"
  | "meli_promo_status"
  | "meli_status"
  | "meli_financing_fee_rate"
  | "meli_installments_text"
  | "meli_catalog_product_id"
>;

function catalogPublicationMap(publications: SalesPublication[]) {
  const result = new Map<string, SalesPublication[]>();
  publications.forEach((publication) => {
    const catalogProductId = String(publication.meli_catalog_product_id || "").trim().toUpperCase();
    if (!catalogProductId || !publication.product_id) return;
    result.set(catalogProductId, [...(result.get(catalogProductId) || []), publication]);
  });
  return result;
}

function uniqueCatalogPublication(catalogProductId: string | null | undefined, publicationsByCatalog: Map<string, SalesPublication[]>) {
  const publications = publicationsByCatalog.get(String(catalogProductId || "").trim().toUpperCase()) || [];
  const productIds = new Set(publications.map((publication) => String(publication.product_id || "")).filter(Boolean));
  if (productIds.size !== 1) return null;
  return [...publications].sort((a, b) => Number(b.meli_status === "active") - Number(a.meli_status === "active"))[0] || null;
}

function publicationSalePrice(publication: SalesPublication) {
  const promoActive = publication.meli_promo_price && /started|active/i.test(publication.meli_promo_status || "");
  return Number((promoActive ? publication.meli_promo_price : publication.meli_price) || 0);
}

function isOnePayPublication(publication: SalesPublication) {
  const text = `${publication.meli_installments_text || ""}`.toLowerCase();
  return Number(publication.meli_financing_fee_rate || 0) === 0 || text.includes("1 pago") || text.includes("clásica") || text.includes("clasica");
}

function onePayLoadedPrice(sku: string, publicationsBySku: Map<string, SalesPublication[]>) {
  const onePayPublications = (publicationsBySku.get(sku) || [])
    .filter(isOnePayPublication)
    .map((publication) => ({
      price: publicationSalePrice(publication),
      active: publication.meli_status === "active",
    }))
    .filter((item) => item.price > 0)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.price - b.price);

  return onePayPublications[0]?.price || null;
}

function normalizedReferencePrice(
  sku: string,
  unitPrice: number,
  publication: SalesPublication | null,
  publicationsBySku: Map<string, SalesPublication[]>,
  actualInstallments?: number | null,
) {
  if (!actualInstallments || actualInstallments <= 1 || (publication && isOnePayPublication(publication))) return unitPrice;
  const loadedOnePayPrice = onePayLoadedPrice(sku, publicationsBySku);
  if (loadedOnePayPrice) return loadedOnePayPrice;
  const financingRate = Number(publication?.meli_financing_fee_rate || 0);
  if (unitPrice > 0 && financingRate > 0) return unitPrice / (1 + financingRate / 100);
  return unitPrice;
}

function normalizedProfitability({
  product,
  publication,
  publicationsBySku,
  categoryFee,
  taxes,
  marginSetting,
  sku,
  unitPrice,
  quantity,
  actualInstallments,
  saleFeeAmount,
  actualShippingAmount,
  shippingSellerCredit,
}: {
  product: Product | null;
  publication: SalesPublication | null;
  publicationsBySku: Map<string, SalesPublication[]>;
  categoryFee: MercadoLibreCategoryFee | null;
  taxes: TaxSettings;
  marginSetting: ProductChannelMargin | null;
  sku: string;
  unitPrice: number;
  quantity: number;
  actualInstallments?: number | null;
  saleFeeAmount?: number | null;
  actualShippingAmount?: number | null;
  shippingSellerCredit?: number | null;
}) {
  if (!product || unitPrice <= 0) {
    return {
      normalized_option_code: "MC",
      normalized_unit_price: unitPrice || null,
      normalized_profit_error: "Producto no encontrado para calcular rentabilidad.",
      profitability_calculated_at: new Date().toISOString(),
    };
  }

  const categoryFeeRate = Number(categoryFee?.marketplace_fee_rate || 0);
  const actualSaleFee = Number(saleFeeAmount || 0);
  // `sale_fee` llega desde la orden y es el costo real por unidad: integra
  // comisión de categoría, cuotas y cualquier cargo fijo de esa venta. Para
  // no alterar el importe con la configuración vigente de la publicación,
  // lo representamos como una única comisión efectiva y anulamos el fijo.
  const observedSaleFeeRate = unitPrice > 0 && actualSaleFee > 0
    ? (actualSaleFee / unitPrice) * 100
    : null;
  const categoryFeeForSale = observedSaleFeeRate === null
    ? categoryFee
    : { ...categoryFee, marketplace_fee_rate: observedSaleFeeRate } as MercadoLibreCategoryFee;
  const actualOption = {
    ...mercadoLibreClassicOption(),
    code: "ML-ACTUAL",
    name: "MercadoLibre venta real",
    financing_fee_rate: observedSaleFeeRate === null ? Number(publication?.meli_financing_fee_rate || 0) : 0,
  };
  // El cargo del envío se obtiene del shipment de esta orden. En Flex es el
  // cargo efectivo a la logística y se distribuye por importe entre los ítems
  // del mismo pedido, por lo que nunca se cobra dos veces.
  const publicationForSale = actualShippingAmount === null || actualShippingAmount === undefined
    ? publication
    : publication
      ? {
        ...publication,
        shipping_cost_amount: actualShippingAmount,
        fixed_fee_amount: observedSaleFeeRate === null ? publication.fixed_fee_amount : 0,
      }
      : null;
  const actualResult = calculatePriceSummary(
    product,
    actualOption,
    categoryFeeForSale,
    taxes,
    publicationForSale as MercadoLibreShippingCost | null,
    {
      salePrice: unitPrice,
      desiredMarginRate: Number(marginSetting?.desired_margin_rate || 0),
      desiredNetProfit: null,
      structureAmount: Number(marginSetting?.structure_amount || 0),
      manualShippingAmount: Number(marginSetting?.manual_shipping_amount || 0),
      salesCommissionRate: Number(marginSetting?.sales_commission_rate || 0),
      saleAppliesVat: marginSetting?.sale_applies_vat ?? true,
      costVatRate: Number(marginSetting?.cost_vat_rate || 0),
      roundTo: 1,
      roundingMode: "nearest",
    },
  ) as {
    valid: boolean;
    netSalePrice?: number | null;
    netProfit?: number | null;
    marginOnNetSale?: number | null;
    marginOnCost?: number | null;
    costForProfit?: number | null;
    marketplaceFeeAmount?: number | null;
    shippingCostAmount?: number | null;
    fixedFeeAmount?: number | null;
    incomeTaxAmount?: number | null;
    error?: string | null;
  };
  // Crédito que Mercado Libre aplica al vendedor en este envío.
  // No se deben sumar promociones del comprador: pertenecen a `receiver`.
  const actualNetProfit = Number(actualResult.netProfit || 0) + Number(shippingSellerCredit || 0);
  const actualNetSalePrice = Number(actualResult.netSalePrice || 0);
  const actualMarginOnNetSale = actualNetSalePrice > 0 ? (actualNetProfit / actualNetSalePrice) * 100 : null;
  const referencePrice = normalizedReferencePrice(sku, unitPrice, publication, publicationsBySku, actualInstallments);
  const referenceNetSalePrice = referencePrice / (1 + Number((marginSetting?.sale_applies_vat ?? true) ? product.vat_rate || 21 : 0) / 100);

  return {
    normalized_option_code: "MC",
    real_unit_price: unitPrice,
    real_net_sale_price: actualResult.valid ? actualNetSalePrice : null,
    real_net_profit: actualResult.valid ? actualNetProfit : null,
    real_total_net_profit: actualResult.valid ? actualNetProfit * quantity : null,
    real_margin_on_net_sale: actualResult.valid ? actualMarginOnNetSale : null,
    normalized_unit_price: referencePrice,
    normalized_net_sale_price: actualResult.valid ? referenceNetSalePrice : null,
    normalized_net_profit: actualResult.valid ? actualNetProfit : null,
    normalized_total_net_profit: actualResult.valid ? actualNetProfit * quantity : null,
    normalized_margin_on_net_sale: actualResult.valid && referenceNetSalePrice > 0 ? (actualNetProfit / referenceNetSalePrice) * 100 : null,
    normalized_margin_on_cost: actualResult.valid ? Number(actualResult.marginOnCost || 0) : null,
    normalized_cost_for_profit: actualResult.valid ? Number(actualResult.costForProfit || 0) : null,
    normalized_product_cost_without_vat: actualResult.valid ? Number(product.cost_without_vat || 0) : null,
    normalized_product_vat_rate: actualResult.valid ? Number(product.vat_rate || 0) : null,
    normalized_marketplace_fee_amount: actualResult.valid ? Number(actualResult.marketplaceFeeAmount || 0) : null,
    normalized_shipping_cost_amount: actualResult.valid ? Number(actualResult.shippingCostAmount || 0) : null,
    normalized_fixed_fee_amount: actualResult.valid ? Number(actualResult.fixedFeeAmount || 0) : null,
    normalized_income_tax_amount: actualResult.valid ? Number(actualResult.incomeTaxAmount || 0) : null,
    normalized_profit_error: actualResult.valid ? null : actualResult.error || "No se pudo calcular rentabilidad normalizada.",
    profitability_calculated_at: new Date().toISOString(),
  };
}

function dateWindows(fromIso: string, toIso: string, chunkDays: number) {
  const result: Array<{ from: string; to: string }> = [];
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  const chunkMs = chunkDays * 86400000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return [{ from: fromIso, to: toIso }];

  let cursor = from;
  while (cursor < to) {
    const next = Math.min(cursor + chunkMs, to);
    result.push({ from: new Date(cursor).toISOString(), to: new Date(next).toISOString() });
    cursor = next + 1;
  }

  return result;
}

function hasDetailedOrderData(order: MeliOrder) {
  if (order.payments?.some((payment) => payment.installments || payment.payment_method_id)) return true;
  return (order.order_items || []).some((item) =>
    item.sale_fee !== undefined ||
    item.listing_type_id !== undefined ||
    item.gross_price !== undefined,
  );
}

async function upsertOrderItemsInBatches(supabase: ReturnType<typeof createAdminClient>, rows: Record<string, unknown>[], batchSize = 100) {
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    // El SKU puede estar vacío en una primera respuesta de ML y aparecer luego al
    // resolver la publicación por catálogo. La restricción actual incluye sku, por
    // lo que eliminamos solo esa versión incompleta antes de guardar la fila correcta.
    await Promise.all(batch
      .filter((row) => String(row.sku || "").trim())
      .map(async (row) => {
        let query = supabase
          .from("mercadolibre_order_items")
          .delete()
          .eq("order_id", String(row.order_id || ""))
          .eq("meli_item_id", String(row.meli_item_id || ""))
          .neq("sku", String(row.sku || ""));
        const variationId = String(row.variation_id || "");
        query = variationId ? query.eq("variation_id", variationId) : query.or("variation_id.is.null,variation_id.eq.");
        const { error } = await query;
        if (error) throw new Error(error.message);
      }));
    const { error } = await supabase
      .from("mercadolibre_order_items")
      .upsert(batch, { onConflict: "order_id,meli_item_id,variation_id,sku" });
    if (error) throw new Error(error.message);
  }
}

async function detailedOrder(order: MeliOrder, account: Awaited<ReturnType<typeof getConnectedMeliAccount>>) {
  const orderId = asString(order.id);
  if (!orderId || hasDetailedOrderData(order)) return order;
  try {
    return (await meliFetch(`/orders/${orderId}`, account)) as MeliOrder;
  } catch {
    return order;
  }
}

async function shipmentCostForOrder(order: MeliOrder, account: Awaited<ReturnType<typeof getConnectedMeliAccount>>, flexRates: FlexShippingRate[]) {
  const shipmentId = asString(order.shipping?.id);
  if (!shipmentId) return null;
  try {
    const [shipment, costs] = await Promise.all([
      meliFetch(`/shipments/${shipmentId}`, account) as Promise<MeliShipment>,
      meliFetch(`/shipments/${shipmentId}/costs`, account) as Promise<MeliShipmentCosts>,
    ]);
    const sender = costs.senders?.[0];
    // Sólo los descuentos del bloque `senders` afectan el resultado del vendedor.
    // `receiver.discounts` es una promoción/costo del comprador y no es un crédito
    // para la cuenta, aunque el importe pueda coincidir con otra orden.
    const sellerCredit = (sender?.discounts || []).reduce((sum, discount) => sum + Number(discount.promoted_amount || 0), 0);
    // Flex informa el cargo efectivo en charge_flex; los demás modos, en cost.
    const flexCharge = Number(sender?.charges?.charge_flex || 0);
    const senderCost = Number(sender?.cost || 0);
    const logisticsType = String(shipment.logistic_type || "").toLowerCase();
    const isFlex = logisticsType === "self_service" || logisticsType.includes("flex");
    const state = String(shipment.receiver_address?.state?.name || "").toLowerCase();
    const city = String(shipment.receiver_address?.city?.name || "").toLowerCase();
    const isCaba = state.includes("capital federal") || city === "caba" || city === "buenos aires";
    const cabaRate = flexRates.find((rate) => rate.active && rate.zone.trim().toLowerCase() === "caba");
    const fallbackFlexCost = isFlex && flexCharge <= 0 && isCaba ? Number(cabaRate?.amount || 0) : 0;
    const resolvedCost = isFlex && flexCharge > 0 ? flexCharge : fallbackFlexCost || senderCost;
    return {
      shipmentId,
      mode: shipment.mode || null,
      logisticType: shipment.logistic_type || null,
      cost: resolvedCost,
      sellerCredit,
      source: isFlex && flexCharge > 0 ? "flex_real" : fallbackFlexCost > 0 ? "flex_tariff_caba" : "meli_shipment_real",
    };
  } catch {
    return { shipmentId, mode: null, logisticType: null, cost: null, source: "shipment_unavailable" };
  }
}

export async function POST(request: Request) {
  try {
    const account = await getConnectedMeliAccount();
    if (!account) {
      return NextResponse.json({ error: "No hay una cuenta de MercadoLibre conectada." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const days = Math.max(7, Math.min(Number(body?.days || 60), 180));
    const from = body?.from || daysAgo(days);
    const to = body?.to || new Date().toISOString();
    const chunkDays = Math.max(1, Math.min(Number(body?.chunkDays || 7), 15));
    const supabase = createAdminClient();

    const [
      { data: productsData, error: productsError },
      { data: publicationsData, error: publicationsError },
      { data: categoryFeesData, error: categoryFeesError },
      { data: taxesData, error: taxesError },
      { data: marginsData, error: marginsError },
      { data: costHistoryData, error: costHistoryError },
      { data: flexRatesData, error: flexRatesError },
    ] = await Promise.all([
      supabase.from("products").select("*").in("status", ["active", "paused"]),
      supabase
        .from("mercadolibre_shipping_costs")
        .select("product_id, sku, meli_item_id, meli_title, fixed_fee_amount, shipping_cost_amount, free_shipping, meli_price, meli_promo_price, meli_promo_status, meli_status, meli_financing_fee_rate, meli_installments_text, meli_catalog_product_id")
        .eq("active", true),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
      supabase.from("tax_settings").select("*").eq("key", "default").maybeSingle(),
      supabase.from("product_channel_margins").select("*").eq("channel_code", "MC"),
      supabase
        .from("product_cost_history")
        .select("product_id, sku, previous_cost_without_vat, new_cost_without_vat, previous_vat_rate, new_vat_rate, changed_at")
        .order("changed_at", { ascending: true }),
      supabase.from("flex_shipping_rates").select("*").eq("active", true),
    ]);

    if (productsError) throw new Error(productsError.message);
    if (publicationsError) throw new Error(publicationsError.message);
    if (categoryFeesError) throw new Error(categoryFeesError.message);
    if (taxesError) throw new Error(taxesError.message);
    if (marginsError) throw new Error(marginsError.message);
    if (costHistoryError) throw new Error(costHistoryError.message);
    if (flexRatesError) throw new Error(flexRatesError.message);

    const products = (productsData || []) as Product[];
    const publications = (publicationsData || []) as SalesPublication[];
    const categoryFees = (categoryFeesData || []) as MercadoLibreCategoryFee[];
    const taxes = (taxesData || defaultTaxSettings()) as TaxSettings;
    const margins = (marginsData || []) as ProductChannelMargin[];
    const costHistory = (costHistoryData || []) as ProductCostHistory[];
    const flexRates = (flexRatesData || []) as FlexShippingRate[];
    const productBySku = mapBySku(products);
    const productById = new Map(products.filter((product) => product.id).map((product) => [String(product.id), product]));
    const publicationByItemId = new Map(publications.filter((item) => item.meli_item_id).map((item) => [String(item.meli_item_id), item]));
    const publicationsByCatalog = catalogPublicationMap(publications);
    const publicationsBySku = new Map<string, SalesPublication[]>();
    publications.forEach((publication) => {
      const publicationSku = normalizeSku(publication.sku || productById.get(String(publication.product_id))?.sku || "");
      if (!publicationSku) return;
      publicationsBySku.set(publicationSku, [...(publicationsBySku.get(publicationSku) || []), publication]);
    });
    const marginByProductAndChannel = new Map(margins.map((item) => [marginKey(item.product_id, item.channel_code), item]));
    const historiesByProductId = new Map<string, ProductCostHistory[]>();
    const historiesBySku = new Map<string, ProductCostHistory[]>();
    costHistory.forEach((history) => {
      if (history.product_id) historiesByProductId.set(String(history.product_id), [...(historiesByProductId.get(String(history.product_id)) || []), history]);
      const sku = normalizeSku(history.sku);
      if (sku) historiesBySku.set(sku, [...(historiesBySku.get(sku) || []), history]);
    });

    const limit = 50;
    let scanned = 0;
    let saved = 0;
    const catalogPublicationByItemId = new Map<string, SalesPublication | null>();
    const windows = dateWindows(from, to, chunkDays).reverse();

    for (const window of windows) {
      const windowRowsByKey = new Map<string, Record<string, unknown>>();
      let offset = 0;

      while (offset < 1000) {
        const params = new URLSearchParams({
          seller: String(account.meli_user_id),
          "order.date_created.from": window.from,
          "order.date_created.to": window.to,
          sort: "date_desc",
          limit: String(limit),
          offset: String(offset),
        });
        const data = await meliFetch(`/orders/search?${params.toString()}`, account);
        const orders = (Array.isArray(data?.results) ? data.results : []) as MeliOrder[];
        scanned += orders.length;

        // La búsqueda no siempre incluye cuotas ni cargos. Pedimos el detalle
        // de los pedidos en grupos chicos para no demorar toda la ventana por
        // una llamada a la vez ni saturar el límite de MercadoLibre.
        const ordersWithDetails: Array<{ searchOrder: MeliOrder; order: MeliOrder }> = [];
        for (let orderIndex = 0; orderIndex < orders.length; orderIndex += 6) {
          const detailBatch = await Promise.all(
            orders.slice(orderIndex, orderIndex + 6).map(async (searchOrder) => ({
              searchOrder,
              order: await detailedOrder(searchOrder, account),
            })),
          );
          ordersWithDetails.push(...detailBatch);
        }

        for (const { searchOrder, order } of ordersWithDetails) {
          const orderId = asString(order.id || searchOrder.id);
          if (!orderId || !order.date_created) continue;

          const shipment = await shipmentCostForOrder(order, account, flexRates);
          const orderGrossTotal = (order.order_items || []).reduce(
            (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
            0,
          );

          for (const orderItem of order.order_items || []) {
            const itemId = asString(orderItem.item?.id);
            if (!itemId) continue;

            const skuFromOrder = normalizeSku(orderItem.item?.seller_sku || null);
            let publication = publicationByItemId.get(itemId) || null;
            if (!skuFromOrder && !publication) {
              if (!catalogPublicationByItemId.has(itemId)) {
                try {
                  const item = await meliFetch(`/items/${itemId}`, account) as MeliItemCatalogLink;
                  catalogPublicationByItemId.set(
                    itemId,
                    uniqueCatalogPublication(item.catalog_product_id, publicationsByCatalog),
                  );
                } catch {
                  catalogPublicationByItemId.set(itemId, null);
                }
              }
              publication = catalogPublicationByItemId.get(itemId) || null;
            }
            const sku = skuFromOrder || normalizeSku(publication?.sku || null);
            const currentProduct = productBySku.get(sku) || productById.get(String(publication?.product_id || "")) || null;
            const product = productWithCostAtDate(currentProduct, order.date_created, historiesByProductId, historiesBySku);
            const quantity = Number(orderItem.quantity || 0);
            const unitPrice = Number(orderItem.unit_price || 0);
            const lineGrossTotal = quantity * unitPrice;
            // Un shipment corresponde a la compra completa. Distribuimos su costo
            // una sola vez, proporcional al importe de cada ítem.
            const allocatedShipping = shipment?.cost === null || shipment?.cost === undefined
              ? null
              : orderGrossTotal > 0 ? Number(shipment.cost) * (lineGrossTotal / orderGrossTotal) : 0;
            // calculatePriceSummary trabaja por unidad. La columna conserva el
            // cargo total asignado al renglón, pero para el cálculo lo dividimos
            // entre las unidades: 3 unidades del mismo SKU pagan 1 envío, no 3.
            const shippingPerUnit = allocatedShipping === null ? null : allocatedShipping / Math.max(quantity, 1);
            const allocatedShippingCredit = shipment?.sellerCredit === null || shipment?.sellerCredit === undefined
              ? null
              : orderGrossTotal > 0 ? Number(shipment.sellerCredit) * (lineGrossTotal / orderGrossTotal) : 0;
            const shippingCreditPerUnit = allocatedShippingCredit === null ? null : allocatedShippingCredit / Math.max(quantity, 1);
            const variationId = asString(orderItem.item?.variation_id);
            const key = [orderId, itemId, variationId, sku].join("|");
            const payment = order.payments?.[0] || null;
            const actualInstallments = payment?.installments ? Number(payment.installments) : null;
            const profitability = normalizedProfitability({
              product,
              publication: publication || null,
              publicationsBySku,
              categoryFee: product ? categoryFeeForProduct(product, categoryFees) : null,
              taxes,
              marginSetting: product ? marginByProductAndChannel.get(marginKey(product.id, "MC")) || null : null,
              sku,
              unitPrice,
              quantity,
              actualInstallments,
              saleFeeAmount: Number(orderItem.sale_fee || 0),
              actualShippingAmount: shippingPerUnit,
              shippingSellerCredit: shippingCreditPerUnit,
            });

            windowRowsByKey.set(key, {
              order_id: orderId,
              order_date: order.date_created,
              status: order.status || null,
              pack_id: order.pack_id ? String(order.pack_id) : null,
              meli_item_id: itemId,
              variation_id: variationId,
              sku,
              product_id: product?.id || publication?.product_id || null,
              title: orderItem.item?.title || publication?.meli_title || product?.name || null,
              quantity,
              unit_price: unitPrice,
              total_amount: Number((quantity * unitPrice).toFixed(2)),
              currency_id: orderItem.currency_id || null,
              listing_type_id: orderItem.listing_type_id || null,
              sale_fee_amount: Number(orderItem.sale_fee || 0),
              gross_price: Number(orderItem.gross_price || 0),
              actual_installments: actualInstallments,
              payment_method_id: payment?.payment_method_id || null,
              shipment_id: shipment?.shipmentId || null,
              shipping_logistic_type: shipment?.logisticType || null,
              shipping_mode: shipment?.mode || null,
              actual_shipping_cost_amount: allocatedShipping,
              shipping_seller_credit_amount: allocatedShippingCredit,
              shipping_cost_source: shipment?.source || null,
              ...profitability,
              raw: orderItem,
              updated_at: new Date().toISOString(),
            });
          }
        }

        const pagingTotal = Number(data?.paging?.total || 0);
        offset += limit;
        if (!orders.length || offset >= pagingTotal) break;
      }

      const windowRows = [...windowRowsByKey.values()];
      if (windowRows.length) {
        await upsertOrderItemsInBatches(supabase, windowRows);
        saved += windowRows.length;
      }
    }

    return NextResponse.json({ ok: true, scanned, saved, from, to, windows: windows.length, chunkDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron sincronizar ventas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
