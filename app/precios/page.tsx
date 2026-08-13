"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import {
  calculatePriceSummary,
  defaultTaxSettings,
  mercadoLibreClassicOption,
  money,
  moneyWithCents,
  normalizeOption,
  percent,
  promoListPrice,
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

type MarginMode = "margin" | "net";
type SyncMode = "none" | "margin" | "net";

type ModalState = {
  product: Product;
  mode: MarginMode;
  syncMode: SyncMode;
  margins: Record<string, number>;
  netProfits: Record<string, number | null>;
  priceOverrides: Record<string, number | null>;
  structureAmounts: Record<string, number>;
  manualShippingAmounts: Record<string, number>;
  salesCommissionRates: Record<string, number>;
  saleAppliesVat: Record<string, boolean>;
  costVatRates: Record<string, number>;
  promoDiscountRates: Record<string, number>;
  summaryChannelCode: string;
  taxOverrides: TaxSettings;
};

export default function PricesPage() {
  const router = useRouter();
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [installments, setInstallments] = useState<
    MercadoLibreInstallmentFee[]
  >([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>(
    [],
  );
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [shippingCosts, setShippingCosts] = useState<
    MercadoLibreShippingCost[]
  >([]);
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>(
    [],
  );
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<
    Record<string, boolean>
  >({});

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    const [
      productsResponse,
      installmentsResponse,
      categoryFeesResponse,
      taxesResponse,
      shippingResponse,
      marginsResponse,
    ] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .neq("status", "discontinued")
        .order("name", { ascending: true }),
      supabase
        .from("mercadolibre_installment_fees")
        .select("*")
        .eq("active", true)
        .order("code", { ascending: true }),
      supabase
        .from("mercadolibre_category_fees")
        .select("*")
        .eq("active", true),
      supabase.from("tax_settings").select("*").eq("key", "default").single(),
      supabase
        .from("mercadolibre_shipping_costs")
        .select("*")
        .eq("active", true),
      supabase.from("product_channel_margins").select("*"),
    ]);
    setLoading(false);

    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);
    if (installmentsResponse.error)
      setError(installmentsResponse.error.message);
    else
      setInstallments(
        (
          (installmentsResponse.data || []) as MercadoLibreInstallmentFee[]
        ).filter((item) => item.code !== "MC"),
      );
    if (categoryFeesResponse.error)
      setError(categoryFeesResponse.error.message);
    else
      setCategoryFees(
        (categoryFeesResponse.data || []) as MercadoLibreCategoryFee[],
      );
    if (taxesResponse.error) setError(taxesResponse.error.message);
    else setTaxes((taxesResponse.data || defaultTaxSettings()) as TaxSettings);
    if (shippingResponse.error) setError(shippingResponse.error.message);
    else
      setShippingCosts(
        (shippingResponse.data || []) as MercadoLibreShippingCost[],
      );
    if (marginsResponse.error) setError(marginsResponse.error.message);
    else
      setMarginSettings((marginsResponse.data || []) as ProductChannelMargin[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pricingOptions = useMemo<MercadoLibrePriceOption[]>(() => {
    const options = [
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
    ];

    return sortPricingOptions(options);
  }, [installments]);

  const categories = useMemo(() => {
    const values = products
      .map((product) => product.category || "")
      .filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es"));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = query.toLowerCase();
    return products.filter((product) => {
      const text =
        `${product.sku} ${product.name} ${product.brand || ""} ${product.model || ""} ${product.category || ""}`.toLowerCase();
      const matchesQuery = !q || text.includes(q);
      const matchesCategory =
        !categoryFilter || (product.category || "") === categoryFilter;
      return matchesQuery && matchesCategory;
    });
  }, [products, query, categoryFilter]);

  function getMargin(productId: string | undefined, channelCode: string) {
    const setting = marginSettings.find(
      (item) =>
        item.product_id === productId && item.channel_code === channelCode,
    );
    return Number(setting?.desired_margin_rate ?? 5);
  }

  function getNetProfit(productId: string | undefined, channelCode: string) {
    const setting = marginSettings.find(
      (item) =>
        item.product_id === productId && item.channel_code === channelCode,
    );
    return setting?.desired_net_profit ?? null;
  }

  function getChannelSetting(
    productId: string | undefined,
    channelCode: string,
  ) {
    return marginSettings.find(
      (item) =>
        item.product_id === productId && item.channel_code === channelCode,
    );
  }

  function formatInputNumber(value: number | null | undefined, decimals = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value)))
      return "";
    const fixed = Number(value).toFixed(decimals);
    return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function allowsExtraSalesCommission(option?: MercadoLibrePriceOption | null) {
    if (!option) return false;
    return !normalizeOption(option).applies_marketplace_fee;
  }

  function publicationInstallmentCount(publication?: MercadoLibreShippingCost | null) {
    if (!publication) return null;
    const text = `${publication.meli_installments_text || ""} ${publication.notes || ""} ${publication.meli_listing_type_id || ""}`.toLowerCase();
    if (text.includes("sin cuotas") || text.includes("1 pago") || text.includes("clasica")) return 1;
    const match = text.match(/(\d{1,2})\s*(x|cuotas?|installments?)/i);
    if (match?.[1]) return Number(match[1]);
    if (text.includes("gold_pro") || text.includes("premium")) return 6;
    return null;
  }

  function optionMatchesPublication(option: MercadoLibrePriceOption, publication: MercadoLibreShippingCost) {
    const optionCount = Number(option.installment_count || 0) || 1;
    const publicationCount = publicationInstallmentCount(publication);
    if (!publicationCount) return false;
    return optionCount === publicationCount;
  }

  function shippingCostForOption(product: Product, option: MercadoLibrePriceOption) {
    const normalizedOption = normalizeOption(option);
    const productCandidates = shippingCosts.filter(
      (item) => item.product_id === product.id || item.sku === product.sku,
    );
    const activeCandidates = productCandidates.filter((item) => item.active !== false && item.meli_status !== "closed");
    const candidates = activeCandidates.length ? activeCandidates : productCandidates;
    if (!candidates.length) return null;

    return [...candidates].sort((a, b) => {
      const score = (item: MercadoLibreShippingCost) => {
        let value = 0;
        if (optionMatchesPublication(normalizedOption, item)) value += 1000;
        if (item.meli_status === "active") value += 100;
        if (item.active !== false) value += 50;
        if (item.product_id === product.id) value += 20;
        if (item.meli_last_sync_at) value += 10;
        if (Number(item.fixed_fee_amount || 0) > 0) value += 8;
        if (Number(item.shipping_cost_amount || 0) > 0) value += 4;
        if (item.meli_item_id) value += 2;
        return value;
      };
      const diff = score(b) - score(a);
      if (diff) return diff;
      return new Date(b.meli_last_sync_at || b.updated_at || 0).getTime() - new Date(a.meli_last_sync_at || a.updated_at || 0).getTime();
    })[0] || null;
  }

  function isMercadoLibreChannel(option?: MercadoLibrePriceOption | null) {
    if (!option) return false;
    const normalized = normalizeOption(option);
    return (
      normalized.channel_type === "mercadolibre" ||
      normalized.code === "MC" ||
      normalized.code?.startsWith("MP")
    );
  }

  function sortPricingOptions(options: MercadoLibrePriceOption[]) {
    const fixedOrder: Record<string, number> = {
      MC: 1,
      MP3: 2,
      MP6: 3,
      MP9: 4,
      MP12: 5,
    };

    return [...options].sort((a, b) => {
      const orderA = fixedOrder[a.code] ?? 1000;
      const orderB = fixedOrder[b.code] ?? 1000;

      if (orderA !== orderB) return orderA - orderB;
      return a.code.localeCompare(b.code, "es");
    });
  }


  function getPromoDiscount(
    productId: string | undefined,
    channelCode: string,
  ) {
    const setting = getChannelSetting(productId, channelCode);
    return Number(setting?.promo_discount_rate || 0);
  }

  function openProductModal(product: Product) {
    const margins: Record<string, number> = {};
    const netProfits: Record<string, number | null> = {};
    const priceOverrides: Record<string, number | null> = {};
    const structureAmounts: Record<string, number> = {};
    const manualShippingAmounts: Record<string, number> = {};
    const salesCommissionRates: Record<string, number> = {};
    const saleAppliesVat: Record<string, boolean> = {};
    const costVatRates: Record<string, number> = {};
    const promoDiscountRates: Record<string, number> = {};
    pricingOptions.forEach((option) => {
      const setting = getChannelSetting(product.id, option.code);
      margins[option.code] = getMargin(product.id, option.code);
      netProfits[option.code] = getNetProfit(product.id, option.code);
      priceOverrides[option.code] = null;
      structureAmounts[option.code] = Number(setting?.structure_amount || 0);
      manualShippingAmounts[option.code] = Number(
        setting?.manual_shipping_amount || 0,
      );
      salesCommissionRates[option.code] = Number(
        setting?.sales_commission_rate || 0,
      );
      saleAppliesVat[option.code] =
        setting?.sale_applies_vat ??
        Boolean(normalizeOption(option).applies_vat);
      costVatRates[option.code] = Number(setting?.cost_vat_rate || 0);
      promoDiscountRates[option.code] = Number(
        setting?.promo_discount_rate || 0,
      );
    });
    setModal({
      product,
      mode: "margin",
      syncMode: "none",
      margins,
      netProfits,
      priceOverrides,
      structureAmounts,
      manualShippingAmounts,
      salesCommissionRates,
      saleAppliesVat,
      costVatRates,
      promoDiscountRates,
      summaryChannelCode: "MC",
      taxOverrides: { ...taxes },
    });
  }

  function effectiveMargin(channelCode: string) {
    if (!modal) return 5;
    if (modal.syncMode === "margin" && channelCode !== "MC")
      return Number(modal.margins.MC ?? 5);
    return Number(modal.margins[channelCode] ?? 5);
  }

  function effectiveNetProfit(channelCode: string) {
    if (!modal) return null;
    if (modal.syncMode === "net" && channelCode !== "MC")
      return modal.netProfits.MC ?? null;
    if (modal.syncMode === "margin") return null;
    return modal.netProfits[channelCode] ?? null;
  }

  async function saveMargins() {
    if (!modal || !modal.product.id) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const rows = modalRows().map(({ option, result }) => ({
      product_id: modal.product.id,
      sku: modal.product.sku,
      channel_code: option.code,
      desired_margin_rate: result.valid
        ? Number(result.marginOnNetSale || 0)
        : effectiveMargin(option.code),
      desired_net_profit: effectiveNetProfit(option.code),
      structure_amount: Number(modal.structureAmounts[option.code] || 0),
      manual_shipping_amount: Number(
        modal.manualShippingAmounts[option.code] || 0,
      ),
      sales_commission_rate: allowsExtraSalesCommission(option)
        ? Number(modal.salesCommissionRates[option.code] || 0)
        : 0,
      sale_applies_vat: Boolean(modal.saleAppliesVat[option.code]),
      cost_vat_rate: Math.max(0, Math.min(Number(modal.product.vat_rate || 21), Number(modal.costVatRates[option.code] || 0))),
      promo_discount_rate: isMercadoLibreChannel(option)
        ? Number(modal.promoDiscountRates[option.code] || 0)
        : 0,
    }));

    const { data, error } = await supabase
      .from("product_channel_margins")
      .upsert(rows, { onConflict: "product_id,channel_code" })
      .select("*");
    setSaving(false);
    if (error) setError(error.message);
    else {
      const savedRows = (data || []) as ProductChannelMargin[];
      setMarginSettings((current) => {
        const savedKeys = new Set(
          savedRows.map((item) => `${item.product_id || item.sku}-${item.channel_code}`),
        );
        const remaining = current.filter(
          (item) => !savedKeys.has(`${item.product_id || item.sku}-${item.channel_code}`),
        );
        return [...remaining, ...savedRows];
      });
      setMessage("Márgenes guardados correctamente.");
      await loadData();
    }
  }

  function updateMargin(channelCode: string, value: string) {
    if (!modal) return;
    const margin = Number(toNumber(value) ?? 0);
    setModal({
      ...modal,
      mode: "margin",
      margins: { ...modal.margins, [channelCode]: margin },
      netProfits: { ...modal.netProfits, [channelCode]: null },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: null },
    });
  }

  function updateNetProfit(channelCode: string, value: string) {
    if (!modal) return;
    const net = toNumber(value);

    if (net === null) {
      setModal({
        ...modal,
        mode: "margin",
        netProfits: { ...modal.netProfits, [channelCode]: null },
        priceOverrides: { ...modal.priceOverrides, [channelCode]: null },
      });
      return;
    }

    const product = modal.product;
    const option = pricingOptions.find((item) => item.code === channelCode);
    if (!option) return;
    const normalizedOption = normalizeOption(option);
    const categoryFee = categoryFees.find(
      (item) =>
        item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    );
    const shippingCost = shippingCostForOption(product, normalizedOption);
    const result = calculatePriceSummary(
      product,
      normalizedOption,
      normalizedOption.applies_marketplace_fee ? categoryFee : null,
      modal.taxOverrides,
      normalizedOption.applies_shipping ? shippingCost : null,
      {
        desiredMarginRate: effectiveMargin(channelCode),
        desiredNetProfit: net,
        salePrice: null,
        structureAmount: modal.structureAmounts[channelCode] || 0,
        manualShippingAmount: modal.manualShippingAmounts[channelCode] || 0,
        salesCommissionRate: modal.salesCommissionRates[channelCode] || 0,
        saleAppliesVat:
          modal.saleAppliesVat[channelCode] ?? normalizedOption.applies_vat,
        costVatRate: modal.costVatRates[channelCode] || 0,
        roundTo: 100,
        roundingMode: "nearest",
      },
    ) as any;

    setModal({
      ...modal,
      mode: "net",
      margins: {
        ...modal.margins,
        [channelCode]: result.valid
          ? Number((result.marginOnNetSale || 0).toFixed(2))
          : Number(modal.margins[channelCode] || 0),
      },
      netProfits: { ...modal.netProfits, [channelCode]: net },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: null },
    });
  }

  function updateSalePrice(channelCode: string, value: string) {
    if (!modal) return;
    const salePrice = toNumber(value);
    if (salePrice === null) {
      setModal({
        ...modal,
        priceOverrides: { ...modal.priceOverrides, [channelCode]: null },
      });
      return;
    }

    const product = modal.product;
    const option = pricingOptions.find((item) => item.code === channelCode);
    if (!option) return;
    const normalizedOption = normalizeOption(option);
    const categoryFee = categoryFees.find(
      (item) =>
        item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    );
    const shippingCost = shippingCostForOption(product, normalizedOption);
    const result = calculatePriceSummary(
      product,
      normalizedOption,
      normalizedOption.applies_marketplace_fee ? categoryFee : null,
      modal.taxOverrides,
      normalizedOption.applies_shipping ? shippingCost : null,
      {
        salePrice,
        desiredMarginRate: effectiveMargin(channelCode),
        desiredNetProfit: null,
        structureAmount: modal.structureAmounts[channelCode] || 0,
        manualShippingAmount: modal.manualShippingAmounts[channelCode] || 0,
        salesCommissionRate: modal.salesCommissionRates[channelCode] || 0,
        saleAppliesVat:
          modal.saleAppliesVat[channelCode] ?? normalizedOption.applies_vat,
        costVatRate: modal.costVatRates[channelCode] || 0,
        roundTo: 100,
        roundingMode: "nearest",
      },
    ) as any;

    setModal({
      ...modal,
      mode: "margin",
      margins: {
        ...modal.margins,
        [channelCode]: result.valid
          ? Number((result.marginOnNetSale || 0).toFixed(2))
          : Number(modal.margins[channelCode] || 0),
      },
      netProfits: { ...modal.netProfits, [channelCode]: null },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: salePrice },
    });
  }

  function setSyncMode(syncMode: SyncMode) {
    if (!modal) return;
    setModal({ ...modal, syncMode });
  }

  function updateTaxOverride(
    field: keyof Pick<TaxSettings, "iibb_rate" | "idc_rate" | "iigg_rate">,
    value: string,
  ) {
    if (!modal) return;
    setModal({
      ...modal,
      taxOverrides: {
        ...modal.taxOverrides,
        [field]: Number(toNumber(value) ?? 0),
      },
    });
  }

  function resetTaxOverrides() {
    if (!modal) return;
    setModal({ ...modal, taxOverrides: { ...taxes } });
  }

  function updateChannelExtra(
    channelCode: string,
    field:
      | "structureAmounts"
      | "manualShippingAmounts"
      | "salesCommissionRates",
    value: string,
  ) {
    if (!modal) return;
    setModal({
      ...modal,
      [field]: {
        ...modal[field],
        [channelCode]: Number(toNumber(value) ?? 0),
      },
    });
  }

  function updateSaleAppliesVat(channelCode: string, checked: boolean) {
    if (!modal) return;
    setModal({
      ...modal,
      saleAppliesVat: {
        ...modal.saleAppliesVat,
        [channelCode]: checked,
      },
    });
  }

  function updateCostVatRate(channelCode: string, value: string) {
    if (!modal) return;
    const productVatRate = Number(modal.product.vat_rate || 21);
    const rate = Math.max(0, Math.min(productVatRate, Number(toNumber(value) ?? 0)));
    setModal({
      ...modal,
      costVatRates: {
        ...modal.costVatRates,
        [channelCode]: rate,
      },
      priceOverrides: { ...modal.priceOverrides, [channelCode]: null },
    });
  }

  function updatePromoDiscount(channelCode: string, value: string) {
    if (!modal) return;
    const discount = Math.max(0, Math.min(99.99, Number(toNumber(value) ?? 0)));
    setModal({
      ...modal,
      promoDiscountRates: {
        ...modal.promoDiscountRates,
        [channelCode]: discount,
      },
    });
  }

  function setSummaryChannel(channelCode: string) {
    if (!modal) return;
    setModal({ ...modal, summaryChannelCode: channelCode });
  }

  function modalRows() {
    if (!modal) return [];
    const product = modal.product;
    const categoryFee = categoryFees.find(
      (item) =>
        item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    );
    return pricingOptions.map((option) => {
      const desiredNetProfit = effectiveNetProfit(option.code);
      const desiredMargin = effectiveMargin(option.code);
      const normalizedOption = normalizeOption(option);
      const feeForOption = normalizedOption.applies_marketplace_fee
        ? categoryFee
        : null;
      const shippingForOption = normalizedOption.applies_shipping
        ? shippingCostForOption(product, normalizedOption)
        : null;
      const salePriceOverride = modal.priceOverrides[option.code] ?? null;
      const result = calculatePriceSummary(
        product,
        normalizedOption,
        feeForOption,
        modal.taxOverrides,
        shippingForOption,
        {
          desiredMarginRate: desiredMargin,
          desiredNetProfit,
          salePrice: salePriceOverride,
          structureAmount: modal.structureAmounts[option.code] || 0,
          manualShippingAmount: modal.manualShippingAmounts[option.code] || 0,
          salesCommissionRate: modal.salesCommissionRates[option.code] || 0,
          saleAppliesVat:
            modal.saleAppliesVat[option.code] ?? normalizedOption.applies_vat,
          costVatRate: modal.costVatRates[option.code] || 0,
          roundTo: 100,
          roundingMode: "nearest",
        },
      );
      return {
        option: normalizedOption,
        categoryFee: feeForOption,
        shippingCost: shippingForOption,
        result: result as any,
        desiredMargin,
        desiredNetProfit,
        displayDesiredMargin:
          desiredNetProfit !== null && (result as any).valid
            ? Number(((result as any).marginOnNetSale || 0).toFixed(2))
            : desiredMargin,
        displayDesiredNetProfit:
          desiredNetProfit !== null
            ? desiredNetProfit
            : (result as any).valid
              ? Number(((result as any).netProfit || 0).toFixed(2))
              : null,
        salePriceOverride,
      };
    });
  }

  function productKey(product: Product) {
    return product.id || product.sku;
  }

  function toggleProductExpanded(product: Product) {
    const key = productKey(product);
    setExpandedProducts((current) => ({ ...current, [key]: !current[key] }));
  }

  function calculateRowsForProduct(product: Product) {
    const categoryFee = categoryFees.find(
      (item) =>
        item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    );
    return pricingOptions.map((option) => {
      const normalizedOption = normalizeOption(option);
      const setting = getChannelSetting(product.id, normalizedOption.code);
      const feeForOption = normalizedOption.applies_marketplace_fee
        ? categoryFee
        : null;
      const shippingForOption = normalizedOption.applies_shipping
        ? shippingCostForOption(product, normalizedOption)
        : null;
      const result = calculatePriceSummary(
        product,
        normalizedOption,
        feeForOption,
        taxes,
        shippingForOption,
        {
          desiredMarginRate: getMargin(product.id, normalizedOption.code),
          desiredNetProfit: getNetProfit(product.id, normalizedOption.code),
          structureAmount: Number(setting?.structure_amount || 0),
          manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
          salesCommissionRate: allowsExtraSalesCommission(normalizedOption)
            ? Number(setting?.sales_commission_rate || 0)
            : 0,
          saleAppliesVat:
            setting?.sale_applies_vat ?? Boolean(normalizedOption.applies_vat),
          costVatRate: Number(setting?.cost_vat_rate || 0),
          roundTo: 100,
          roundingMode: "nearest",
        },
      ) as any;
      const promoDiscountRate = isMercadoLibreChannel(normalizedOption)
        ? getPromoDiscount(product.id, normalizedOption.code)
        : 0;
      const promoPrice = result.valid
        ? promoListPrice(result.roundedPrice, promoDiscountRate)
        : null;
      return {
        option: normalizedOption,
        result,
        promoDiscountRate,
        promoPrice,
      };
    });
  }

  function calculateMcPriceForProduct(product: Product) {
    const categoryFee = categoryFees.find(
      (item) =>
        item.category?.toLowerCase() === (product.category || "").toLowerCase(),
    );
    const mcOption = mercadoLibreClassicOption();
    const shippingCost = shippingCostForOption(product, mcOption);
    const result = calculatePriceSummary(
      product,
      mcOption,
      categoryFee,
      taxes,
      shippingCost,
      {
        desiredMarginRate: getMargin(product.id, "MC"),
        desiredNetProfit: getNetProfit(product.id, "MC"),
        roundTo: 100,
        roundingMode: "nearest",
      },
    ) as any;
    return result.valid ? moneyWithCents(result.roundedPrice) : "-";
  }

  const currentRows = modalRows();
  const mcRow = currentRows.find((row) => row.option.code === "MC");
  const selectedSummaryRow =
    currentRows.find(
      (row) => row.option.code === (modal?.summaryChannelCode || "MC"),
    ) || mcRow;
  const selectedChannelCode = selectedSummaryRow?.option.code || "MC";
  const selectedChannelName =
    selectedSummaryRow?.option.name || "MercadoLibre Clásica";
  const selectedMarginLocked = Boolean(
    modal && modal.syncMode === "margin" && selectedChannelCode !== "MC",
  );
  const selectedNetLocked = Boolean(
    modal && modal.syncMode === "net" && selectedChannelCode !== "MC",
  );
  const selectedPromoDiscount = modal
    ? Number(modal.promoDiscountRates[selectedChannelCode] || 0)
    : 0;
  const selectedPromoPrice = selectedSummaryRow?.result?.valid
    ? promoListPrice(
        selectedSummaryRow.result.roundedPrice,
        selectedPromoDiscount,
      )
    : null;
  const otherRows = currentRows.filter((row) => row.option.code !== "MC");

  return (
    <main className="container wide prices-page">
      <PageHero
        title="Precios"
        description="Buscá un producto, abrí el resumen y definí el margen deseado o la ganancia neta por canal."
        onRefresh={loadData}
        onLogout={logout}
      />

      {error && <div className="message error">{error}</div>}
      {message && <div className="message success">{message}</div>}

      <section className="card filters-card" style={{ marginBottom: 20 }}>
        <div className="grid two">
          <div className="field">
            <label>Buscar producto</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por SKU, nombre, marca o modelo"
            />
          </div>
          <div className="field">
            <label>Categoría</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">Todas las categorías</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card products-table-card">
        {loading ? (
          <p>Cargando productos...</p>
        ) : (
          <div className="table-wrap">
            <table className="products-list-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Costo s/IVA</th>
                  <th>IVA</th>
                  <th>Margen base</th>
                  <th>Precio MC</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const key = productKey(product);
                  const isExpanded = Boolean(expandedProducts[key]);
                  const productRows = isExpanded
                    ? calculateRowsForProduct(product)
                    : [];
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td>{product.sku}</td>
                        <td>
                          <div className="product-name-cell">
                            <strong>{product.name}</strong>
                            <span className="small">
                              {product.brand || ""} {product.model || ""}
                            </span>
                          </div>
                        </td>
                        <td>{product.category || "-"}</td>
                        <td>{money(product.cost_without_vat)}</td>
                        <td>{product.vat_rate}%</td>
                        <td>{percent(getMargin(product.id, "MC"))}</td>
                        <td>
                          <strong>{calculateMcPriceForProduct(product)}</strong>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="button ghost small-button"
                              onClick={() => toggleProductExpanded(product)}
                            >
                              {isExpanded ? "Contraer" : "Ver canales"}
                            </button>
                            <button
                              className="button ghost small-button"
                              onClick={() => openProductModal(product)}
                            >
                              Calcular / editar
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${key}-channels`} className="expanded-row">
                          <td colSpan={8}>
                            <div className="channel-breakdown">
                              <div className="channel-breakdown-header">
                                <div>
                                  <div className="channel-breakdown-title">Condiciones de venta</div>
                                  <p className="small">Precios y rentabilidad por canal para este producto.</p>
                                </div>
                              </div>
                              <table className="nested-table">
                                <thead>
                                  <tr>
                                    <th>Condición / canal</th>
                                    <th>Precio de venta</th>
                                    <th>Rentabilidad %</th>
                                    <th>Ganancia</th>
                                    <th>Desc. promo</th>
                                    <th>Precio promo</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {productRows.map(
                                    ({
                                      option,
                                      result,
                                      promoDiscountRate,
                                      promoPrice,
                                    }) => (
                                      <tr key={`${key}-${option.code}`}>
                                        <td>
                                          <strong>{option.code}</strong>
                                          <br />
                                          <span className="small">
                                            {option.name}
                                          </span>
                                        </td>
                                        <td>
                                          <strong>
                                            {result.valid
                                              ? moneyWithCents(
                                                  result.roundedPrice,
                                                )
                                              : "-"}
                                          </strong>
                                        </td>
                                        <td>
                                          {result.valid
                                            ? percent(result.marginOnNetSale)
                                            : "-"}
                                        </td>
                                        <td>
                                          {result.valid
                                            ? moneyWithCents(result.netProfit)
                                            : "-"}
                                        </td>
                                        <td>
                                          {isMercadoLibreChannel(option)
                                            ? percent(promoDiscountRate)
                                            : "-"}
                                        </td>
                                        <td className="promo-price-cell">
                                          <strong>
                                            {isMercadoLibreChannel(option) &&
                                            promoPrice
                                              ? moneyWithCents(promoPrice)
                                              : "-"}
                                          </strong>
                                        </td>
                                      </tr>
                                    ),
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={8}>No se encontraron productos.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <div className="modal-backdrop pricing-backdrop">
          <div className="modal-card pricing-modal-v2">
            <div className="pricing-modal-header">
              <div>
                <h2>{modal.product.name}</h2>
                <p className="pricing-modal-meta">
                  SKU {modal.product.sku} <span>•</span> Categoría {modal.product.category || "sin categoría"} <span>•</span> Costo {money(modal.product.cost_without_vat)} + IVA {modal.product.vat_rate}%
                </p>
                <p className="pricing-modal-help">
                  Podés elegir qué canal ver en el resumen. Ajustá margen, precio de venta, comisiones, envío manual y estructura para analizar rentabilidad.
                </p>
              </div>
              <button className="modal-close-button" onClick={() => setModal(null)} aria-label="Cerrar">
                ×
              </button>
            </div>

            <div className="pricing-top-grid">
              <section className="pricing-card pricing-card-blue">
                <div className="pricing-card-title">
                  <span className="section-badge blue">1</span>
                  <h3>Condición seleccionada</h3>
                </div>

                <div className="field">
                  <label>Canal</label>
                  <select
                    value={modal.summaryChannelCode}
                    onChange={(e) => setSummaryChannel(e.target.value)}
                  >
                    {currentRows.map((row) => (
                      <option key={row.option.code} value={row.option.code}>
                        {row.option.code} - {row.option.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="linked-fields">
                  <div className="field">
                    <label>Margen deseado %</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(selectedSummaryRow?.displayDesiredMargin ?? effectiveMargin(selectedChannelCode))}
                      onChange={(e) => updateMargin(selectedChannelCode, e.target.value)}
                      disabled={modal.syncMode === "net" || selectedMarginLocked}
                      className={modal.syncMode === "net" || selectedMarginLocked ? "input-disabled" : ""}
                    />
                  </div>
                  <span className="link-pill" title="Precio y margen vinculados">↔</span>
                  <div className="field">
                    <label>Ganancia neta objetivo</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(selectedSummaryRow?.displayDesiredNetProfit ?? effectiveNetProfit(selectedChannelCode))}
                      placeholder="Opcional"
                      onChange={(e) => updateNetProfit(selectedChannelCode, e.target.value)}
                      disabled={modal.syncMode === "margin" || selectedNetLocked}
                      className={modal.syncMode === "margin" || selectedNetLocked ? "input-disabled" : ""}
                    />
                  </div>
                </div>

                <div className="sync-hint">Vinculados: margen, ganancia objetivo y precio se recalculan entre sí.</div>

                <div className="sync-options polished-sync-options">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={modal.syncMode === "margin"}
                      onChange={(e) => setSyncMode(e.target.checked ? "margin" : "none")}
                    />
                    <span>Aplicar % a todos</span>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={modal.syncMode === "net"}
                      onChange={(e) => setSyncMode(e.target.checked ? "net" : "none")}
                    />
                    <span>Aplicar margen a todos</span>
                  </label>
                </div>
                <p className="small">
                  Si elegís otro canal en el resumen, estos campos modifican ese canal. Si activás aplicar a todos, las demás condiciones toman el valor de MC y quedan bloqueadas.
                </p>
              </section>

              <section className="pricing-card pricing-card-green">
                <div className="pricing-card-title">
                  <span className="section-icon green">▦</span>
                  <h3>Impuestos para esta prueba</h3>
                </div>
                <p className="small">Estos valores modifican solo este cálculo. No cambian la solapa Impuestos.</p>
                <div className="even-input-grid">
                  <div className="field">
                    <label>IIBB %</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(modal.taxOverrides.iibb_rate)}
                      onChange={(e) => updateTaxOverride("iibb_rate", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>IDC %</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(modal.taxOverrides.idc_rate)}
                      onChange={(e) => updateTaxOverride("idc_rate", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>IIGG %</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInputNumber(modal.taxOverrides.iigg_rate)}
                      onChange={(e) => updateTaxOverride("iigg_rate", e.target.value)}
                    />
                  </div>
                </div>
                <button className="button ghost tax-reset-button accent-green" type="button" onClick={resetTaxOverrides}>
                  Restablecer impuestos globales
                </button>
              </section>

              <section className="pricing-card pricing-card-purple">
                <div className="pricing-card-title">
                  <span className="section-icon purple">▣</span>
                  <h3>Costos extra del canal elegido</h3>
                </div>
                <p className="small">Estos valores aplican solo al canal seleccionado en el resumen.</p>

                {selectedSummaryRow?.result?.valid ? (
                  <div className="even-input-grid">
                    {!isMercadoLibreChannel(selectedSummaryRow.option) && (
                      <div className="field">
                        <label>IVA atribuido al costo %</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatInputNumber(modal.costVatRates[selectedSummaryRow.option.code] || 0)}
                          onChange={(e) => updateCostVatRate(selectedSummaryRow.option.code, e.target.value)}
                        />
                        <span className="small">Máximo: {percent(modal.product.vat_rate)}</span>
                      </div>
                    )}
                    {isMercadoLibreChannel(selectedSummaryRow.option) && (
                      <>
                        <div className="field">
                          <label>Descuento promo %</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={formatInputNumber(modal.promoDiscountRates[selectedSummaryRow.option.code] || 0)}
                            onChange={(e) => updatePromoDiscount(selectedSummaryRow.option.code, e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label>Precio promo publicado</label>
                          <input
                            type="text"
                            value={selectedPromoPrice ? formatInputNumber(selectedPromoPrice, 0) : ""}
                            readOnly
                            className="input-disabled"
                          />
                        </div>
                      </>
                    )}
                    {allowsExtraSalesCommission(selectedSummaryRow.option) && (
                      <div className="field">
                        <label>Comisión venta %</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatInputNumber(modal.salesCommissionRates[selectedSummaryRow.option.code] || 0)}
                          onChange={(e) => updateChannelExtra(selectedSummaryRow.option.code, "salesCommissionRates", e.target.value)}
                        />
                      </div>
                    )}
                    {!selectedSummaryRow.option.applies_shipping && (
                      <div className="field">
                        <label>Envío manual $</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatInputNumber(modal.manualShippingAmounts[selectedSummaryRow.option.code] || 0, 0)}
                          onChange={(e) => updateChannelExtra(selectedSummaryRow.option.code, "manualShippingAmounts", e.target.value)}
                        />
                      </div>
                    )}
                    <div className="field">
                      <label>Estructura $</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={formatInputNumber(modal.structureAmounts[selectedSummaryRow.option.code] || 0, 0)}
                        onChange={(e) => updateChannelExtra(selectedSummaryRow.option.code, "structureAmounts", e.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <span className="message error">No se pudo calcular el canal seleccionado.</span>
                )}
              </section>

              <aside className="pricing-card summary-panel-v2">
                <div className="pricing-card-title summary-title-row">
                  <span className="section-icon neutral">▤</span>
                  <h3>Resumen</h3>
                </div>
                <div className="field">
                  <select
                    value={modal.summaryChannelCode}
                    onChange={(e) => setSummaryChannel(e.target.value)}
                  >
                    {currentRows.map((row) => (
                      <option key={row.option.code} value={row.option.code}>
                        {row.option.code} - {row.option.name}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedSummaryRow?.result?.valid ? (
                  <div className="summary-content-v2">
                    <div className="field summary-price-field">
                      <label>Precio de venta</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={formatInputNumber(
                          modal.priceOverrides[selectedSummaryRow.option.code] ?? selectedSummaryRow.result.roundedPrice,
                          0,
                        )}
                        onChange={(e) => updateSalePrice(selectedSummaryRow.option.code, e.target.value)}
                      />
                      <span className="sync-hint compact-hint">Vinculado con el margen deseado %</span>
                    </div>
                    {isMercadoLibreChannel(selectedSummaryRow.option) && (
                      <>
                        <div className="summary-line"><span>Descuento promo</span><strong>{percent(selectedPromoDiscount)}</strong></div>
                        <div className="summary-line"><span>Precio promo publicado</span><strong>{selectedPromoPrice ? moneyWithCents(selectedPromoPrice) : "-"}</strong></div>
                      </>
                    )}
                    <div className="summary-line"><span>IVA venta</span><strong>-{moneyWithCents(selectedSummaryRow.result.vatAmount)}</strong></div>
                    <div className="summary-line"><span>Precio sin IVA</span><strong>{moneyWithCents(selectedSummaryRow.result.netSalePrice)}</strong></div>
                    <div className="summary-line"><span>Comisión canal</span><strong>-{moneyWithCents(selectedSummaryRow.result.marketplaceFeeAmount)}</strong></div>
                    {allowsExtraSalesCommission(selectedSummaryRow.option) && (
                      <div className="summary-line"><span>Comisión venta extra</span><strong>-{moneyWithCents(selectedSummaryRow.result.salesCommissionAmount)}</strong></div>
                    )}
                    <div className="summary-line"><span>Ingresos brutos</span><strong>-{moneyWithCents(selectedSummaryRow.result.iibbAmount)}</strong></div>
                    <div className="summary-divider" />
                    <div className="summary-line"><span>Envío s/IVA</span><strong>-{moneyWithCents(selectedSummaryRow.result.shippingCostAmount)}</strong></div>
                    <div className="summary-line"><span>Fijo ML s/IVA</span><strong>-{moneyWithCents(selectedSummaryRow.result.fixedFeeAmount || 0)}</strong></div>
                    <div className="summary-line"><span>Gasto de estructura</span><strong>-{moneyWithCents(selectedSummaryRow.result.structureAmount)}</strong></div>
                    <div className="summary-line"><span>IVA atribuido al costo</span><strong>-{moneyWithCents(selectedSummaryRow.result.costVatAmount || 0)}</strong></div>
                    <div className="summary-line"><span>Costo usado</span><strong>-{moneyWithCents(selectedSummaryRow.result.costForProfit)}</strong></div>
                    <div className="summary-divider" />
                    <div className="summary-line"><span>Margen bruto</span><strong>{moneyWithCents(selectedSummaryRow.result.grossProfit)}</strong></div>
                    <div className="summary-line"><span>Imp. Ganancias</span><strong>-{moneyWithCents(selectedSummaryRow.result.incomeTaxAmount)}</strong></div>
                    <div className="summary-result-box">
                      <div><span>Ganancia</span><strong>{moneyWithCents(selectedSummaryRow.result.netProfit)}</strong></div>
                      <div><span>Margen real</span><strong>{percent(selectedSummaryRow.result.marginOnNetSale)}</strong></div>
                    </div>
                  </div>
                ) : (
                  <span className="message error">
                    {selectedSummaryRow?.result?.error || "No se pudo calcular el resumen."}
                  </span>
                )}
              </aside>
            </div>

            <section className="pricing-conditions-card">
              <div className="pricing-conditions-header">
                <div>
                  <h3>Condiciones de venta</h3>
                  <p className="small">Editá margen, precio, promo, IVA costo y extras por canal.</p>
                </div>
              </div>
              <div className="table-wrap polished-table-wrap">
                <table className="pricing-conditions-table">
                  <thead>
                    <tr>
                      <th>Condición / canal</th>
                      <th>Margen deseado %</th>
                      <th>Ganancia neta objetivo</th>
                      <th>Precio de venta</th>
                      <th>Desc. promo %</th>
                      <th>Precio promo</th>
                      <th>IVA costo %</th>
                      <th>Comisión venta %</th>
                      <th>Envío manual $</th>
                      <th>Estructura $</th>
                      <th>Ganancia</th>
                      <th>Margen real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRows.map(({ option, result, displayDesiredMargin, displayDesiredNetProfit }) => {
                      const lockMargin = modal.syncMode === "margin" && option.code !== "MC";
                      const lockNet = modal.syncMode === "net" && option.code !== "MC";
                      const rowSelected = option.code === selectedChannelCode;

                      return (
                        <tr key={option.code} className={rowSelected ? "selected-channel-row" : ""}>
                          <td>
                            <div className="channel-name-cell">
                              <span className={`channel-badge channel-badge-${option.code.toLowerCase()}`}>{option.code}</span>
                              <div>
                                <strong>{option.name}</strong>
                              </div>
                            </div>
                          </td>
                          <td style={{ minWidth: 130 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatInputNumber(displayDesiredMargin)}
                              onChange={(e) => updateMargin(option.code, e.target.value)}
                              disabled={lockMargin || lockNet}
                              className={lockMargin || lockNet ? "input-disabled" : ""}
                            />
                          </td>
                          <td style={{ minWidth: 150 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatInputNumber(displayDesiredNetProfit)}
                              placeholder="Opcional"
                              onChange={(e) => updateNetProfit(option.code, e.target.value)}
                              disabled={lockMargin || lockNet}
                              className={lockMargin || lockNet ? "input-disabled" : ""}
                            />
                          </td>
                          <td className="price-input-cell" style={{ minWidth: 150 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatInputNumber(
                                modal.priceOverrides[option.code] ?? (result.valid ? result.roundedPrice : null),
                                0,
                              )}
                              onChange={(e) => updateSalePrice(option.code, e.target.value)}
                              disabled={lockMargin || lockNet}
                              className={lockMargin || lockNet ? "input-disabled" : ""}
                            />
                          </td>
                          <td style={{ minWidth: 120 }}>
                            {isMercadoLibreChannel(option) ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formatInputNumber(modal.promoDiscountRates[option.code] || 0)}
                                onChange={(e) => updatePromoDiscount(option.code, e.target.value)}
                              />
                            ) : (
                              <span className="not-applicable">No aplica</span>
                            )}
                          </td>
                          <td style={{ minWidth: 130 }}>
                            {isMercadoLibreChannel(option) && result.valid
                              ? moneyWithCents(promoListPrice(result.roundedPrice, modal.promoDiscountRates[option.code] || 0))
                              : "-"}
                          </td>
                          <td style={{ minWidth: 110 }}>
                            {!isMercadoLibreChannel(option) ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formatInputNumber(modal.costVatRates[option.code] || 0)}
                                onChange={(e) => updateCostVatRate(option.code, e.target.value)}
                              />
                            ) : (
                              <span className="not-applicable">No aplica</span>
                            )}
                          </td>
                          <td style={{ minWidth: 120 }}>
                            {allowsExtraSalesCommission(option) ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formatInputNumber(modal.salesCommissionRates[option.code] || 0)}
                                onChange={(e) => updateChannelExtra(option.code, "salesCommissionRates", e.target.value)}
                              />
                            ) : (
                              <span className="not-applicable">No aplica</span>
                            )}
                          </td>
                          <td style={{ minWidth: 120 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatInputNumber(modal.manualShippingAmounts[option.code] || 0, 0)}
                              onChange={(e) => updateChannelExtra(option.code, "manualShippingAmounts", e.target.value)}
                              disabled={Boolean(option.applies_shipping)}
                              className={option.applies_shipping ? "input-disabled" : ""}
                            />
                          </td>
                          <td style={{ minWidth: 120 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatInputNumber(modal.structureAmounts[option.code] || 0, 0)}
                              onChange={(e) => updateChannelExtra(option.code, "structureAmounts", e.target.value)}
                            />
                          </td>
                          <td>{result.valid ? moneyWithCents(result.netProfit) : "-"}</td>
                          <td>{result.valid ? percent(result.marginOnNetSale) : result.error}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="pricing-modal-footer">
              <button className="button ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <div className="actions">
                <button className="button ghost" disabled={saving} onClick={saveMargins}>
                  {saving ? "Guardando..." : "Guardar como borrador"}
                </button>
                <button
                  className="button"
                  disabled={saving}
                  onClick={async () => {
                    await saveMargins();
                    setModal(null);
                  }}
                >
                  {saving ? "Guardando..." : "Guardar y cerrar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
