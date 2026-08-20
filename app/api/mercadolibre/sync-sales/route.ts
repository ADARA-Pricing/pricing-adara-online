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
  order_items?: MeliOrderItem[];
  payments?: Array<{
    installments?: number | null;
    payment_method_id?: string | null;
  }>;
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

function normalizedProfitability({
  product,
  publication,
  categoryFee,
  taxes,
  marginSetting,
  unitPrice,
  quantity,
}: {
  product: Product | null;
  publication: Pick<MercadoLibreShippingCost, "fixed_fee_amount" | "shipping_cost_amount" | "free_shipping"> | null;
  categoryFee: MercadoLibreCategoryFee | null;
  taxes: TaxSettings;
  marginSetting: ProductChannelMargin | null;
  unitPrice: number;
  quantity: number;
}) {
  if (!product || unitPrice <= 0) {
    return {
      normalized_option_code: "MC",
      normalized_unit_price: unitPrice || null,
      normalized_profit_error: "Producto no encontrado para calcular rentabilidad.",
      profitability_calculated_at: new Date().toISOString(),
    };
  }

  const result = calculatePriceSummary(
    product,
    mercadoLibreClassicOption(),
    categoryFee,
    taxes,
    publication as MercadoLibreShippingCost | null,
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

  return {
    normalized_option_code: "MC",
    normalized_unit_price: unitPrice,
    normalized_net_sale_price: result.valid ? Number(result.netSalePrice || 0) : null,
    normalized_net_profit: result.valid ? Number(result.netProfit || 0) : null,
    normalized_total_net_profit: result.valid ? Number(result.netProfit || 0) * quantity : null,
    normalized_margin_on_net_sale: result.valid ? Number(result.marginOnNetSale || 0) : null,
    normalized_margin_on_cost: result.valid ? Number(result.marginOnCost || 0) : null,
    normalized_cost_for_profit: result.valid ? Number(result.costForProfit || 0) : null,
    normalized_marketplace_fee_amount: result.valid ? Number(result.marketplaceFeeAmount || 0) : null,
    normalized_shipping_cost_amount: result.valid ? Number(result.shippingCostAmount || 0) : null,
    normalized_fixed_fee_amount: result.valid ? Number(result.fixedFeeAmount || 0) : null,
    normalized_income_tax_amount: result.valid ? Number(result.incomeTaxAmount || 0) : null,
    normalized_profit_error: result.valid ? null : result.error || "No se pudo calcular rentabilidad normalizada.",
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

async function detailedOrder(order: MeliOrder, account: Awaited<ReturnType<typeof getConnectedMeliAccount>>) {
  const orderId = asString(order.id);
  if (!orderId || hasDetailedOrderData(order)) return order;
  try {
    return (await meliFetch(`/orders/${orderId}`, account)) as MeliOrder;
  } catch {
    return order;
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
    ] = await Promise.all([
      supabase.from("products").select("*").eq("status", "active"),
      supabase
        .from("mercadolibre_shipping_costs")
        .select("product_id, sku, meli_item_id, meli_title, fixed_fee_amount, shipping_cost_amount, free_shipping")
        .eq("active", true),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
      supabase.from("tax_settings").select("*").eq("key", "default").maybeSingle(),
      supabase.from("product_channel_margins").select("*").eq("channel_code", "MC"),
    ]);

    if (productsError) throw new Error(productsError.message);
    if (publicationsError) throw new Error(publicationsError.message);
    if (categoryFeesError) throw new Error(categoryFeesError.message);
    if (taxesError) throw new Error(taxesError.message);
    if (marginsError) throw new Error(marginsError.message);

    const products = (productsData || []) as Product[];
    const publications = (publicationsData || []) as Pick<
      MercadoLibreShippingCost,
      "product_id" | "sku" | "meli_item_id" | "meli_title" | "fixed_fee_amount" | "shipping_cost_amount" | "free_shipping"
    >[];
    const categoryFees = (categoryFeesData || []) as MercadoLibreCategoryFee[];
    const taxes = (taxesData || defaultTaxSettings()) as TaxSettings;
    const margins = (marginsData || []) as ProductChannelMargin[];
    const productBySku = mapBySku(products);
    const productById = new Map(products.filter((product) => product.id).map((product) => [String(product.id), product]));
    const publicationByItemId = new Map(publications.filter((item) => item.meli_item_id).map((item) => [String(item.meli_item_id), item]));
    const marginByProductAndChannel = new Map(margins.map((item) => [marginKey(item.product_id, item.channel_code), item]));

    const rowsByKey = new Map<string, Record<string, unknown>>();
    const limit = 50;
    let scanned = 0;
    const windows = dateWindows(from, to, chunkDays);

    for (const window of windows) {
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

        for (const searchOrder of orders) {
          const order = await detailedOrder(searchOrder, account);
          const orderId = asString(order.id || searchOrder.id);
          if (!orderId || !order.date_created) continue;

          for (const orderItem of order.order_items || []) {
            const itemId = asString(orderItem.item?.id);
            if (!itemId) continue;

            const skuFromOrder = normalizeSku(orderItem.item?.seller_sku || null);
            const publication = publicationByItemId.get(itemId);
            const sku = skuFromOrder || normalizeSku(publication?.sku || null);
            const product = productBySku.get(sku) || productById.get(String(publication?.product_id || "")) || null;
            const quantity = Number(orderItem.quantity || 0);
            const unitPrice = Number(orderItem.unit_price || 0);
            const variationId = asString(orderItem.item?.variation_id);
            const key = [orderId, itemId, variationId, sku].join("|");
            const payment = order.payments?.[0] || null;
            const profitability = normalizedProfitability({
              product,
              publication: publication || null,
              categoryFee: product ? categoryFeeForProduct(product, categoryFees) : null,
              taxes,
              marginSetting: product ? marginByProductAndChannel.get(marginKey(product.id, "MC")) || null : null,
              unitPrice,
              quantity,
            });

            rowsByKey.set(key, {
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
              actual_installments: payment?.installments ? Number(payment.installments) : null,
              payment_method_id: payment?.payment_method_id || null,
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
    }

    const rows = [...rowsByKey.values()];
    if (rows.length) {
      const { error } = await supabase
        .from("mercadolibre_order_items")
        .upsert(rows, { onConflict: "order_id,meli_item_id,variation_id,sku" });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, scanned, saved: rows.length, from, to, windows: windows.length, chunkDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron sincronizar ventas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
