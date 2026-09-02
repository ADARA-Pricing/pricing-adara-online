"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChartNoAxesCombined,
  Check,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Store,
  Tags,
  Trash2,
} from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { createClient } from "@/lib/supabase";
import {
  calculatePriceSummary,
  defaultTaxSettings,
  moneyWithCents,
  normalizeOption,
  percent,
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

const emptyInstallment: MercadoLibreInstallmentFee = {
  code: "",
  name: "",
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
  notes: ""
};

const emptyCategory: MercadoLibreCategoryFee = {
  category: "",
  marketplace_fee_rate: 0,
  active: true,
  notes: ""
};

type MeliCategoryImportRow = {
  meli_category_id: string;
  meli_category_name: string;
  meli_category_path: string;
  suggested_category: string;
  marketplace_fee_rate: number;
  publication_count: number;
  active_publications: number;
  paused_publications: number;
  sample_titles: string[];
  exists: boolean;
  existing_category: string | null;
};

type MeliCategoryImportPreview = {
  total_items: number;
  total_categories: number;
  missing: number;
  existing: number;
  rows: MeliCategoryImportRow[];
};

type ViewMode = "channel" | "category";
type SortDirection = "asc" | "desc";
type ConfigViewMode = "channels" | "categories";
type ConfigChannelSortKey = "code" | "name" | "channelType" | "installments" | "financing" | "active";
type ConfigCategorySortKey = "category" | "marketplaceFeeRate" | "sync" | "active";
type ChannelSortKey =
  | "code"
  | "marketplaceRate"
  | "financingRate"
  | "taxRate"
  | "shippingAmount"
  | "totalCostAmount"
  | "totalCostRate"
  | "basePrice";
type CategorySortKey =
  | "category"
  | "marketplaceRate"
  | "shippingAmount"
  | "taxRate"
  | "totalCostAmount"
  | "totalCostRate";

type CostBreakdown = {
  marketplaceAmount: number;
  financingAmount: number;
  salesCommissionAmount: number;
  fixedFeeAmount: number;
  shippingAmount: number;
  taxesAmount: number;
  structureAmount: number;
  totalCostAmount: number;
  totalCostRate: number;
  basePrice: number;
  netSalePrice: number;
  taxRate: number;
  marketplaceRate: number;
  financingRate: number;
};

type ProductCostRow = CostBreakdown & {
  channelCode: string;
  channelName: string;
  channelType: string;
  category: string;
  productId?: string;
  sku: string;
  hasConfiguredShipping: boolean;
};

type ChannelCostRow = CostBreakdown & {
  code: string;
  name: string;
  channelType: string;
  productCount: number;
  missingShippingCount: number;
};

type CategoryCostRow = CostBreakdown & {
  category: string;
  productCount: number;
  channelCount: number;
  missingShippingCount: number;
};

function numberValue(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function boolLabel(value?: boolean | null) {
  return value ? "Sí" : "No";
}

function channelTypeLabel(value?: string | null) {
  if (value === "mercadolibre") return "MercadoLibre";
  if (value === "directo") return "Directo";
  if (value === "web") return "Web";
  if (value === "posnet") return "Posnet";
  if (value === "otro") return "Otro";
  return value || "-";
}

function tablePercent(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `${Number(value).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function dateLabel(value?: string | null) {
  if (!value) return "Sin sincronizar";
  const date = new Date(value);
  const datePart = date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart} · ${timePart}`;
}

function listLabel(values?: string[] | null) {
  if (!Array.isArray(values) || values.length === 0) return "-";
  return values.slice(0, 3).join(", ") + (values.length > 3 ? ` +${values.length - 3}` : "");
}

function defaultFlag(value: boolean | null | undefined, fallback = false) {
  return value ?? fallback;
}

export default function MercadoLibrePage() {
  const router = useRouter();
  const supabase = createClient();
  const [installments, setInstallments] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categories, setCategories] = useState<MercadoLibreCategoryFee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [shippingCosts, setShippingCosts] = useState<MercadoLibreShippingCost[]>([]);
  const [marginSettings, setMarginSettings] = useState<ProductChannelMargin[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [installmentForm, setInstallmentForm] = useState<MercadoLibreInstallmentFee>(emptyInstallment);
  const [categoryForm, setCategoryForm] = useState<MercadoLibreCategoryFee>(emptyCategory);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("channel");
  const [channelSortKey, setChannelSortKey] = useState<ChannelSortKey>("totalCostAmount");
  const [categorySortKey, setCategorySortKey] = useState<CategorySortKey>("totalCostAmount");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [configViewMode, setConfigViewMode] = useState<ConfigViewMode>("channels");
  const [channelConfigQuery, setChannelConfigQuery] = useState("");
  const [channelTypeFilter, setChannelTypeFilter] = useState("");
  const [channelStatusFilter, setChannelStatusFilter] = useState("");
  const [categoryConfigQuery, setCategoryConfigQuery] = useState("");
  const [categoryStatusFilter, setCategoryStatusFilter] = useState("");
  const [onlyUnsyncedCategories, setOnlyUnsyncedCategories] = useState(false);
  const [configChannelSortKey, setConfigChannelSortKey] = useState<ConfigChannelSortKey>("code");
  const [configCategorySortKey, setConfigCategorySortKey] = useState<ConfigCategorySortKey>("category");
  const [configSortDirection, setConfigSortDirection] = useState<SortDirection>("asc");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingMeli, setSyncingMeli] = useState(false);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showCategoryImport, setShowCategoryImport] = useState(false);
  const [categoryImportPreview, setCategoryImportPreview] = useState<MeliCategoryImportPreview | null>(null);
  const [categoryImportLoading, setCategoryImportLoading] = useState(false);
  const [categoryImportSaving, setCategoryImportSaving] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categoryImportNames, setCategoryImportNames] = useState<Record<string, string>>({});

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
    const [
      installmentsResponse,
      categoriesResponse,
      taxesResponse,
      productsResponse,
      shippingResponse,
      marginsResponse,
    ] = await Promise.all([
      supabase.from("mercadolibre_installment_fees").select("*").order("code", { ascending: true }),
      supabase.from("mercadolibre_category_fees").select("*").order("category", { ascending: true }),
      supabase.from("tax_settings").select("*").eq("key", "default").maybeSingle(),
      supabase.from("products").select("*").eq("status", "active"),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true),
      supabase.from("product_channel_margins").select("*"),
    ]);
    setLoading(false);

    if (installmentsResponse.error) setError(installmentsResponse.error.message);
    else setInstallments((installmentsResponse.data || []) as MercadoLibreInstallmentFee[]);

    if (categoriesResponse.error) setError(categoriesResponse.error.message);
    else setCategories((categoriesResponse.data || []) as MercadoLibreCategoryFee[]);

    if (taxesResponse.error) setError(taxesResponse.error.message);
    else if (taxesResponse.data) setTaxes(taxesResponse.data as TaxSettings);

    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);

    if (shippingResponse.error) setError(shippingResponse.error.message);
    else setShippingCosts((shippingResponse.data || []) as MercadoLibreShippingCost[]);

    if (marginsResponse.error) setError(marginsResponse.error.message);
    else setMarginSettings((marginsResponse.data || []) as ProductChannelMargin[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateInstallment<K extends keyof MercadoLibreInstallmentFee>(key: K, value: MercadoLibreInstallmentFee[K]) {
    setInstallmentForm((current) => ({ ...current, [key]: value }));
  }

  function updateCategory<K extends keyof MercadoLibreCategoryFee>(key: K, value: MercadoLibreCategoryFee[K]) {
    setCategoryForm((current) => ({ ...current, [key]: value }));
  }

  async function syncFromMercadoLibre() {
    setSyncingMeli(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/mercadolibre/sync-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "installments", pageLimit: 60 }),
      });
      const raw = await response.text();
      let data: { error?: string; installment_fee_updates?: number };
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Mercado Libre devolvió un error sin detalle JSON: ${raw.slice(0, 180) || "sin respuesta"}`);
      }
      if (!response.ok) throw new Error(data?.error || "No se pudo sincronizar MercadoLibre.");

      setMessage(
        `Costos de cuotas actualizados: ${data.installment_fee_updates || 0}.`
      );
      await loadData();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudo sincronizar MercadoLibre.");
    } finally {
      setSyncingMeli(false);
    }
  }

  async function loadCategoryImportPreview() {
    setCategoryImportLoading(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/mercadolibre/import-categories");
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudieron leer las categorías de MercadoLibre.");

      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const names = rows.reduce((acc: Record<string, string>, row: MeliCategoryImportRow) => {
        acc[row.meli_category_id] = row.suggested_category || row.meli_category_name || row.meli_category_id;
        return acc;
      }, {});

      setCategoryImportPreview({
        total_items: Number(data?.total_items || 0),
        total_categories: Number(data?.total_categories || rows.length || 0),
        missing: Number(data?.missing || 0),
        existing: Number(data?.existing || 0),
        rows,
      });
      setCategoryImportNames(names);
      setSelectedCategoryIds([]);
      setShowCategoryImport(true);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No se pudieron leer las categorías de MercadoLibre.");
    } finally {
      setCategoryImportLoading(false);
    }
  }

  async function startCategoryImport() {
    setShowChannelForm(false);
    setShowCategoryForm(false);
    if (showCategoryImport && categoryImportPreview) {
      setShowCategoryImport(false);
      return;
    }
    setShowCategoryImport(true);
    await loadCategoryImportPreview();
  }

  function toggleCategorySelection(categoryId: string, checked: boolean) {
    setSelectedCategoryIds((current) => (
      checked ? [...new Set([...current, categoryId])] : current.filter((id) => id !== categoryId)
    ));
  }

  function updateCategoryImportName(categoryId: string, value: string) {
    setCategoryImportNames((current) => ({ ...current, [categoryId]: value }));
  }

  async function importSelectedCategories() {
    setCategoryImportSaving(true);
    setMessage(null);
    setError(null);

    try {
      const categoriesToImport = selectedCategoryIds
        .map((id) => ({ meli_category_id: id, category: (categoryImportNames[id] || "").trim() }))
        .filter((entry) => entry.category);

      if (categoriesToImport.length === 0) {
        setError("Seleccioná al menos una categoría y asignale un nombre.");
        return;
      }

      const response = await fetch("/api/mercadolibre/import-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: categoriesToImport }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudieron importar las categorías.");

      setMessage(`Categorías importadas: ${data.imported || 0}.`);
      setSelectedCategoryIds([]);
      await loadData();
      await loadCategoryImportPreview();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No se pudieron importar las categorías.");
    } finally {
      setCategoryImportSaving(false);
    }
  }

  function applyChannelPreset(channelType: string) {
    if (channelType === "directo") {
      setInstallmentForm((current) => ({
        ...current,
        channel_type: "directo",
        financing_fee_rate: 0,
        installment_count: null,
        applies_marketplace_fee: false,
        applies_shipping: false,
        applies_iibb: false,
        applies_idc: false,
        applies_iigg: false,
        applies_structure: false,
        applies_vat: false
      }));
      return;
    }

    if (channelType === "mercadolibre") {
      setInstallmentForm((current) => ({
        ...current,
        channel_type: "mercadolibre",
        applies_marketplace_fee: true,
        applies_shipping: true,
        applies_iibb: true,
        applies_idc: true,
        applies_iigg: true,
        applies_structure: true,
        applies_vat: true
      }));
      return;
    }

    setInstallmentForm((current) => ({ ...current, channel_type: channelType }));
  }

  async function saveInstallment(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const payload = {
      code: installmentForm.code.trim().toUpperCase(),
      name: installmentForm.name.trim(),
      channel_type: installmentForm.channel_type || "mercadolibre",
      installment_count: installmentForm.installment_count ?? null,
      financing_fee_rate: Number(installmentForm.financing_fee_rate || 0),
      applies_marketplace_fee: Boolean(installmentForm.applies_marketplace_fee),
      applies_shipping: Boolean(installmentForm.applies_shipping),
      applies_iibb: Boolean(installmentForm.applies_iibb),
      applies_idc: Boolean(installmentForm.applies_idc),
      applies_iigg: Boolean(installmentForm.applies_iigg),
      applies_structure: Boolean(installmentForm.applies_structure),
      applies_vat: Boolean(installmentForm.applies_vat),
      active: Boolean(installmentForm.active),
      notes: installmentForm.notes?.trim() || null
    };

    if (!payload.code || !payload.name) {
      setError("Código y nombre son obligatorios.");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("mercadolibre_installment_fees").upsert(payload, { onConflict: "code" });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(`Canal guardado: ${payload.code}`);
    setInstallmentForm(emptyInstallment);
    setShowChannelForm(false);
    await loadData();
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const payload = {
      category: categoryForm.category.trim(),
      marketplace_fee_rate: Number(categoryForm.marketplace_fee_rate || 0),
      active: Boolean(categoryForm.active),
      notes: categoryForm.notes?.trim() || null
    };

    if (!payload.category) {
      setError("La categoría es obligatoria.");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("mercadolibre_category_fees").upsert(payload, { onConflict: "category" });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(`Comisión por categoría guardada: ${payload.category}`);
    setCategoryForm(emptyCategory);
    setShowCategoryForm(false);
    await loadData();
  }

  async function deleteInstallment(item: MercadoLibreInstallmentFee) {
    const ok = window.confirm(`¿Seguro que querés eliminar el canal ${item.code} - ${item.name}?`);
    if (!ok) return;
    setError(null);
    setMessage(null);
    const { error } = await supabase.from("mercadolibre_installment_fees").delete().eq("code", item.code);
    if (error) setError(error.message);
    else {
      setMessage(`Canal eliminado: ${item.code}`);
      await loadData();
    }
  }

  async function deleteCategory(item: MercadoLibreCategoryFee) {
    const ok = window.confirm(`¿Seguro que querés eliminar la categoría ${item.category}?`);
    if (!ok) return;
    setError(null);
    setMessage(null);
    const { error } = await supabase.from("mercadolibre_category_fees").delete().eq("category", item.category);
    if (error) setError(error.message);
    else {
      setMessage(`Categoría eliminada: ${item.category}`);
      await loadData();
    }
  }

  function editInstallment(item: MercadoLibreInstallmentFee) {
    const isMl = item.channel_type === "mercadolibre" || item.code.startsWith("MP") || item.code === "MC";
    setInstallmentForm({
      ...emptyInstallment,
      ...item,
      channel_type: item.channel_type || (isMl ? "mercadolibre" : "directo"),
      applies_marketplace_fee: defaultFlag(item.applies_marketplace_fee, isMl),
      applies_shipping: defaultFlag(item.applies_shipping, isMl),
      applies_iibb: defaultFlag(item.applies_iibb, isMl),
      applies_idc: defaultFlag(item.applies_idc, isMl),
      applies_iigg: defaultFlag(item.applies_iigg, isMl),
      applies_structure: defaultFlag(item.applies_structure, isMl),
      applies_vat: defaultFlag(item.applies_vat, isMl)
    });
    setShowCategoryForm(false);
    setShowCategoryImport(false);
    setShowChannelForm(true);
    setMessage(`Editando ${item.code}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editCategory(item: MercadoLibreCategoryFee) {
    setCategoryForm({ ...emptyCategory, ...item });
    setShowChannelForm(false);
    setShowCategoryImport(false);
    setShowCategoryForm(true);
    setMessage(`Editando categoría ${item.category}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNewChannel() {
    setInstallmentForm(emptyInstallment);
    setMessage(null);
    setError(null);
    setShowCategoryForm(false);
    setShowCategoryImport(false);
    setShowChannelForm((current) => !current);
  }

  function startNewCategory() {
    setCategoryForm(emptyCategory);
    setMessage(null);
    setError(null);
    setShowChannelForm(false);
    setShowCategoryImport(false);
    setShowCategoryForm((current) => !current);
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

  const activeChannels = useMemo(() => {
    return sortPricingOptions(installments.filter((item) => item.active !== false) as MercadoLibrePriceOption[]);
  }, [installments]);

  const activeCategories = useMemo(() => {
    return categories.filter((item) => item.active !== false);
  }, [categories]);

  const productCategories = useMemo(() => {
    return [...new Set(products.map((product) => product.category).filter(Boolean) as string[])]
      .sort((a, b) => a.localeCompare(b, "es"));
  }, [products]);

  const productCostRows = useMemo<ProductCostRow[]>(() => {
    return products.flatMap((product) => {
      const categoryFee =
        activeCategories.find(
          (item) =>
            item.category.trim().toLowerCase() ===
            (product.category || "").trim().toLowerCase(),
        ) || null;

      return activeChannels.map((option) => {
        const normalizedOption = normalizeOption(option);
        const setting = marginSettings.find(
          (item) => item.product_id === product.id && item.channel_code === option.code,
        );
        const shippingCost = shippingCostForOption(product, normalizedOption);
        const summary = calculatePriceSummary(
          product,
          normalizedOption,
          categoryFee,
          taxes,
          shippingCost,
          {
            desiredMarginRate: Number(setting?.desired_margin_rate ?? 5),
            desiredNetProfit: setting?.desired_net_profit ?? null,
            structureAmount: Number(setting?.structure_amount || 0),
            manualShippingAmount: Number(setting?.manual_shipping_amount || 0),
            salesCommissionRate: Number(setting?.sales_commission_rate || 0),
            saleAppliesVat: setting?.sale_applies_vat ?? normalizedOption.applies_vat,
            costVatRate: Number(setting?.cost_vat_rate || 0),
            roundTo: 100,
            roundingMode: "nearest",
          },
        );
        const summaryValues = summary as unknown as Record<string, number | null | undefined>;
        const channelFeeAmount = Number(summaryValues.marketplaceFeeAmount || 0);
        const marketplaceRate = Number(summaryValues.marketplaceFeeRate || 0);
        const financingRate = Number(summaryValues.financingFeeRate || 0);
        const channelFeeRate = marketplaceRate + financingRate;
        const marketplaceAmount = channelFeeRate > 0 ? channelFeeAmount * (marketplaceRate / channelFeeRate) : 0;
        const financingAmount = channelFeeAmount - marketplaceAmount;
        const taxesAmount =
          Number(summaryValues.iibbAmount || 0) +
          Number(summaryValues.idcAmount || 0) +
          Number(summaryValues.incomeTaxAmount || 0);
        const fixedFeeAmount = Number(summaryValues.fixedFeeAmount || 0);
        const shippingAmount = Number(summaryValues.shippingCostAmount || 0);
        const structureAmount = Number(summaryValues.structureAmount || 0);
        const salesCommissionAmount = Number(summaryValues.salesCommissionAmount || 0);
        const totalCostAmount =
          marketplaceAmount +
          financingAmount +
          salesCommissionAmount +
          fixedFeeAmount +
          shippingAmount +
          taxesAmount +
          structureAmount;
        const netSalePrice = Number(summaryValues.netSalePrice || 0);
        const hasConfiguredShipping = !normalizedOption.applies_shipping || Boolean(shippingCost);

        return {
          channelCode: option.code,
          channelName: option.name,
          channelType: normalizedOption.channel_type || "otro",
          category: product.category || "Sin categoría",
          productId: product.id,
          sku: product.sku,
          marketplaceAmount,
          financingAmount,
          salesCommissionAmount,
          fixedFeeAmount,
          shippingAmount,
          taxesAmount,
          structureAmount,
          totalCostAmount,
          totalCostRate: netSalePrice > 0 ? (totalCostAmount / netSalePrice) * 100 : 0,
          basePrice: Number(summaryValues.roundedPrice || 0),
          netSalePrice,
          taxRate: Number(summaryValues.taxesRate || 0),
          marketplaceRate,
          financingRate,
          hasConfiguredShipping,
        };
      });
    });
  }, [activeCategories, activeChannels, marginSettings, products, shippingCosts, taxes]);

  function averageBreakdown(rows: ProductCostRow[]): CostBreakdown {
    const count = Math.max(rows.length, 1);
    const sum = (key: keyof CostBreakdown) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
    return {
      marketplaceAmount: sum("marketplaceAmount") / count,
      financingAmount: sum("financingAmount") / count,
      salesCommissionAmount: sum("salesCommissionAmount") / count,
      fixedFeeAmount: sum("fixedFeeAmount") / count,
      shippingAmount: sum("shippingAmount") / count,
      taxesAmount: sum("taxesAmount") / count,
      structureAmount: sum("structureAmount") / count,
      totalCostAmount: sum("totalCostAmount") / count,
      totalCostRate: sum("totalCostRate") / count,
      basePrice: sum("basePrice") / count,
      netSalePrice: sum("netSalePrice") / count,
      taxRate: sum("taxRate") / count,
      marketplaceRate: sum("marketplaceRate") / count,
      financingRate: sum("financingRate") / count,
    };
  }

  const channelRows = useMemo<ChannelCostRow[]>(() => {
    return activeChannels.map((channel) => {
      const rows = productCostRows.filter((row) => row.channelCode === channel.code);
      return {
        code: channel.code,
        name: channel.name,
        channelType: normalizeOption(channel).channel_type || "otro",
        ...averageBreakdown(rows),
        productCount: rows.length,
        missingShippingCount: rows.filter((row) => !row.hasConfiguredShipping).length,
      };
    });
  }, [activeChannels, productCostRows]);

  const categoryRows = useMemo<CategoryCostRow[]>(() => {
    const grouped = new Map<string, ProductCostRow[]>();
    productCostRows.forEach((row) => {
      if (categoryFilter && row.category !== categoryFilter) return;
      grouped.set(row.category, [...(grouped.get(row.category) || []), row]);
    });
    return [...grouped.entries()].map(([category, rows]) => ({
      category,
      ...averageBreakdown(rows),
      productCount: new Set(rows.map((row) => row.productId || row.sku)).size,
      channelCount: new Set(rows.map((row) => row.channelCode)).size,
      missingShippingCount: rows.filter((row) => !row.hasConfiguredShipping).length,
    }));
  }, [categoryFilter, productCostRows]);

  const filteredChannelRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return channelRows
      .filter((row) => {
        if (categoryFilter) {
          const hasCategory = productCostRows.some((productRow) => productRow.channelCode === row.code && productRow.category === categoryFilter);
          if (!hasCategory) return false;
        }
        if (!search) return true;
        return `${row.code} ${row.name} ${row.channelType}`.toLowerCase().includes(search);
      })
      .sort((a, b) => compareRows(a, b, channelSortKey, sortDirection));
  }, [categoryFilter, channelRows, channelSortKey, productCostRows, query, sortDirection]);

  const filteredCategoryRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return categoryRows
      .filter((row) => !search || row.category.toLowerCase().includes(search))
      .sort((a, b) => compareRows(a, b, categorySortKey, sortDirection));
  }, [categoryRows, categorySortKey, query, sortDirection]);

  const kpis = useMemo(() => {
    const comparable = filteredChannelRows.filter((row) => row.productCount > 0);
    const lowest = [...comparable].sort((a, b) => a.totalCostRate - b.totalCostRate)[0] || null;
    const highest = [...comparable].sort((a, b) => b.totalCostRate - a.totalCostRate)[0] || null;
    return {
      configuredChannels: activeChannels.length,
      lowest,
      highest,
      spread: lowest && highest ? highest.totalCostRate - lowest.totalCostRate : 0,
    };
  }, [activeChannels.length, filteredChannelRows]);

  function compareRows<T extends Record<string, unknown>>(a: T, b: T, key: keyof T, direction: SortDirection) {
    const multiplier = direction === "asc" ? 1 : -1;
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" || typeof bv === "string") {
      return String(av || "").localeCompare(String(bv || ""), "es") * multiplier;
    }
    return (Number(av || 0) - Number(bv || 0)) * multiplier;
  }

  function changeChannelSort(key: ChannelSortKey) {
    if (channelSortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setChannelSortKey(key);
    setSortDirection(key === "code" ? "asc" : "desc");
  }

  function changeCategorySort(key: CategorySortKey) {
    if (categorySortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setCategorySortKey(key);
    setSortDirection(key === "category" ? "asc" : "desc");
  }

  function SortIcon({ active }: { active: boolean }) {
    if (!active) return <ArrowUpDown className="idle-sort-icon" aria-hidden="true" />;
    return sortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />;
  }

  function ChannelSortButton({ column, children }: { column: ChannelSortKey; children: ReactNode }) {
    return (
      <button className={`cost-channel-sort-trigger ${channelSortKey === column ? "active" : ""}`} type="button" onClick={() => changeChannelSort(column)}>
        {children}
        <SortIcon active={channelSortKey === column} />
      </button>
    );
  }

  function CategorySortButton({ column, children }: { column: CategorySortKey; children: ReactNode }) {
    return (
      <button className={`cost-channel-sort-trigger ${categorySortKey === column ? "active" : ""}`} type="button" onClick={() => changeCategorySort(column)}>
        {children}
        <SortIcon active={categorySortKey === column} />
      </button>
    );
  }

  function relationBadge(row: ChannelCostRow) {
    if (kpis.lowest && row.code === kpis.lowest.code) return <span className="badge badge-success">Menor costo</span>;
    if (kpis.highest && row.code === kpis.highest.code) return <span className="badge badge-warning">Mayor costo</span>;
    return null;
  }

  const channelTypes = useMemo(() => {
    return [...new Set(installments.map((item) => item.channel_type || "").filter(Boolean))]
      .sort((a, b) => channelTypeLabel(a).localeCompare(channelTypeLabel(b), "es"));
  }, [installments]);

  const filteredInstallments = useMemo(() => {
    const search = channelConfigQuery.trim().toLowerCase();
    return installments
      .filter((item) => {
        const isMl = item.channel_type === "mercadolibre" || item.code.startsWith("MP") || item.code === "MC";
        const type = item.channel_type || (isMl ? "mercadolibre" : "directo");
        if (channelTypeFilter && type !== channelTypeFilter) return false;
        if (channelStatusFilter === "active" && !item.active) return false;
        if (channelStatusFilter === "inactive" && item.active) return false;
        if (!search) return true;
        return `${item.code} ${item.name} ${type}`.toLowerCase().includes(search);
      })
      .sort((a, b) => {
        const multiplier = configSortDirection === "asc" ? 1 : -1;
        if (configChannelSortKey === "code") return a.code.localeCompare(b.code, "es") * multiplier;
        if (configChannelSortKey === "name") return a.name.localeCompare(b.name, "es") * multiplier;
        if (configChannelSortKey === "channelType") return String(a.channel_type || "").localeCompare(String(b.channel_type || ""), "es") * multiplier;
        if (configChannelSortKey === "installments") return (Number(a.installment_count || 0) - Number(b.installment_count || 0)) * multiplier;
        if (configChannelSortKey === "financing") return (Number(a.financing_fee_rate || 0) - Number(b.financing_fee_rate || 0)) * multiplier;
        return (Number(Boolean(a.active)) - Number(Boolean(b.active))) * multiplier;
      });
  }, [channelConfigQuery, channelStatusFilter, channelTypeFilter, configChannelSortKey, configSortDirection, installments]);

  const filteredConfigCategories = useMemo(() => {
    const search = categoryConfigQuery.trim().toLowerCase();
    return categories
      .filter((item) => {
        if (categoryStatusFilter === "active" && !item.active) return false;
        if (categoryStatusFilter === "inactive" && item.active) return false;
        if (onlyUnsyncedCategories && item.meli_last_sync_at) return false;
        if (!search) return true;
        return [
          item.category,
          listLabel(item.meli_category_names),
          item.notes,
        ].join(" ").toLowerCase().includes(search);
      })
      .sort((a, b) => {
        const multiplier = configSortDirection === "asc" ? 1 : -1;
        if (configCategorySortKey === "category") return a.category.localeCompare(b.category, "es") * multiplier;
        if (configCategorySortKey === "marketplaceFeeRate") return (Number(a.marketplace_fee_rate || 0) - Number(b.marketplace_fee_rate || 0)) * multiplier;
        if (configCategorySortKey === "sync") return (new Date(a.meli_last_sync_at || 0).getTime() - new Date(b.meli_last_sync_at || 0).getTime()) * multiplier;
        return (Number(Boolean(a.active)) - Number(Boolean(b.active))) * multiplier;
      });
  }, [categories, categoryConfigQuery, categoryStatusFilter, configCategorySortKey, configSortDirection, onlyUnsyncedCategories]);

  function changeConfigChannelSort(key: ConfigChannelSortKey) {
    if (configChannelSortKey === key) {
      setConfigSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setConfigChannelSortKey(key);
    setConfigSortDirection(key === "code" || key === "name" || key === "channelType" ? "asc" : "desc");
  }

  function changeConfigCategorySort(key: ConfigCategorySortKey) {
    if (configCategorySortKey === key) {
      setConfigSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setConfigCategorySortKey(key);
    setConfigSortDirection(key === "category" ? "asc" : "desc");
  }

  function ConfigSortIcon({ active }: { active: boolean }) {
    if (!active) return <ArrowUpDown className="idle-sort-icon" aria-hidden="true" />;
    return configSortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />;
  }

  function ConfigChannelSortButton({ column, children }: { column: ConfigChannelSortKey; children: ReactNode }) {
    return (
      <button className={`cost-config-sort-trigger ${configChannelSortKey === column ? "active" : ""}`} type="button" onClick={() => changeConfigChannelSort(column)}>
        {children}
        <ConfigSortIcon active={configChannelSortKey === column} />
      </button>
    );
  }

  function ConfigCategorySortButton({ column, children }: { column: ConfigCategorySortKey; children: ReactNode }) {
    return (
      <button className={`cost-config-sort-trigger ${configCategorySortKey === column ? "active" : ""}`} type="button" onClick={() => changeConfigCategorySort(column)}>
        {children}
        <ConfigSortIcon active={configCategorySortKey === column} />
      </button>
    );
  }

  function BooleanMark({ value, label }: { value: boolean; label: string }) {
    return value ? (
      <Check className="cost-config-check" aria-label={label} />
    ) : (
      <Minus className="cost-config-minus" aria-label={`No ${label.toLowerCase()}`} />
    );
  }

  function StatusBadge({ active, activeLabel = "Activo", inactiveLabel = "Inactivo" }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
    return <span className={`badge cost-config-status ${active ? "active" : "inactive"}`}>{active ? activeLabel : inactiveLabel}</span>;
  }

  return (
    <main className="container wide cost-channel-page">
      <PageHero
        title="Costo x Canal"
        description="Configurá los costos, impuestos y comisiones utilizados por cada canal y categoría."
        icon={<ChartNoAxesCombined aria-hidden="true" />}
        actions={(
          <>
            <button type="button" className="button ghost" onClick={syncFromMercadoLibre} disabled={syncingMeli}>
              <RefreshCw aria-hidden="true" />
              {syncingMeli ? "Actualizando cuotas..." : "Actualizar cuotas ML"}
            </button>
            <button type="button" className="button ghost" onClick={loadData} disabled={loading}>
              Actualizar
            </button>
          </>
        )}
      />

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="cost-config-tabs" aria-label="Configuración de costo por canal">
        <button type="button" className={configViewMode === "channels" ? "active" : ""} onClick={() => setConfigViewMode("channels")}>Canales</button>
        <button type="button" className={configViewMode === "categories" ? "active" : ""} onClick={() => setConfigViewMode("categories")}>Categorías</button>
      </section>

      {configViewMode === "channels" ? (
        <section className="card cost-config-card">
          <SectionHeader
            icon={<Store aria-hidden="true" />}
            title="Canales de venta"
            description="Definí financiación, impuestos y costos aplicables a cada canal."
            actions={(
              <button type="button" className="button small-button" onClick={startNewChannel}>
                <Plus aria-hidden="true" />
                Nuevo canal
              </button>
            )}
          />

          <div className="cost-config-toolbar">
            <label className="search-control">
              <Search aria-hidden="true" />
              <input className="search-field" value={channelConfigQuery} onChange={(event) => setChannelConfigQuery(event.target.value)} placeholder="Buscar código o canal..." />
            </label>
            <select value={channelTypeFilter} onChange={(event) => setChannelTypeFilter(event.target.value)}>
              <option value="">Todos los tipos</option>
              {channelTypes.map((type) => <option key={type} value={type}>{channelTypeLabel(type)}</option>)}
            </select>
            <select value={channelStatusFilter} onChange={(event) => setChannelStatusFilter(event.target.value)}>
              <option value="">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </div>

          <div className="cost-config-table-status">
            <span>{filteredInstallments.length === installments.length ? `${installments.length} canales` : `${filteredInstallments.length} de ${installments.length} canales`}</span>
            {(channelConfigQuery || channelTypeFilter || channelStatusFilter) && (
              <button className="button ghost small-button" type="button" onClick={() => { setChannelConfigQuery(""); setChannelTypeFilter(""); setChannelStatusFilter(""); }}>
                Limpiar filtros
              </button>
            )}
          </div>

          {loading ? (
            <div className="cost-channel-skeleton"><span /><span /><span /></div>
          ) : (
            <div className="table-wrap cost-config-table-wrap">
              <table className="cost-config-table">
                <thead>
                  <tr>
                    <th>
                      <div className="cost-config-channel-sort-stack">
                        <ConfigChannelSortButton column="code">Código</ConfigChannelSortButton>
                        <ConfigChannelSortButton column="name">Nombre</ConfigChannelSortButton>
                      </div>
                    </th>
                    <th><ConfigChannelSortButton column="channelType">Tipo</ConfigChannelSortButton></th>
                    <th className="numeric-header"><ConfigChannelSortButton column="installments">Cuotas</ConfigChannelSortButton></th>
                    <th className="numeric-header"><ConfigChannelSortButton column="financing">Financiación</ConfigChannelSortButton></th>
                    <th className="boolean-header">ML</th>
                    <th className="boolean-header">Envío</th>
                    <th className="boolean-header">IIBB</th>
                    <th className="boolean-header">IIGG</th>
                    <th className="boolean-header">IVA</th>
                    <th><ConfigChannelSortButton column="active">Estado</ConfigChannelSortButton></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInstallments.map((item) => {
                    const isMl = item.channel_type === "mercadolibre" || item.code.startsWith("MP") || item.code === "MC";
                    const type = item.channel_type || (isMl ? "mercadolibre" : "directo");
                    return (
                      <tr key={item.id || item.code}>
                        <td>
                          <div className="cost-config-main-cell">
                            <strong>{item.code}</strong>
                            <span>{item.name}</span>
                          </div>
                        </td>
                        <td>{channelTypeLabel(type)}</td>
                        <td className="numeric-cell">{item.installment_count || "-"}</td>
                        <td className="numeric-cell">{tablePercent(item.financing_fee_rate)}</td>
                        <td className="boolean-cell"><BooleanMark value={defaultFlag(item.applies_marketplace_fee, isMl)} label="ML" /></td>
                        <td className="boolean-cell"><BooleanMark value={defaultFlag(item.applies_shipping, isMl)} label="Envío" /></td>
                        <td className="boolean-cell"><BooleanMark value={defaultFlag(item.applies_iibb, isMl)} label="IIBB" /></td>
                        <td className="boolean-cell"><BooleanMark value={defaultFlag(item.applies_iigg, isMl)} label="IIGG" /></td>
                        <td className="boolean-cell"><BooleanMark value={defaultFlag(item.applies_vat, isMl)} label="IVA" /></td>
                        <td><StatusBadge active={Boolean(item.active)} /></td>
                        <td>
                          <div className="cost-config-actions">
                            <button className="button ghost small-button" onClick={() => editInstallment(item)}><Pencil aria-hidden="true" />Editar</button>
                            <button className="button danger small-button" onClick={() => deleteInstallment(item)} title={`Eliminar ${item.code}`}><Trash2 aria-hidden="true" />Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredInstallments.length === 0 && <tr><td colSpan={11}>No hay canales que coincidan con los filtros.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="card cost-config-card">
          <SectionHeader
            icon={<Tags aria-hidden="true" />}
            title="Categorías"
            description="Configurá comisiones y asociaciones con categorías de MercadoLibre."
            actions={(
              <div className="cost-config-header-actions">
                <button type="button" className="button ghost small-button" onClick={startCategoryImport} disabled={categoryImportLoading}>
                  {categoryImportLoading ? "Leyendo ML..." : "Importar categorías ML"}
                </button>
                <button type="button" className="button small-button" onClick={startNewCategory}>
                  <Plus aria-hidden="true" />
                  Nueva categoría
                </button>
              </div>
            )}
          />

          <div className="cost-config-toolbar categories">
            <label className="search-control">
              <Search aria-hidden="true" />
              <input className="search-field" value={categoryConfigQuery} onChange={(event) => setCategoryConfigQuery(event.target.value)} placeholder="Buscar categoría o categoría ML..." />
            </label>
            <select value={categoryStatusFilter} onChange={(event) => setCategoryStatusFilter(event.target.value)}>
              <option value="">Todos los estados</option>
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
            </select>
            <label className={`cost-config-toggle ${onlyUnsyncedCategories ? "active" : ""}`}>
              <input type="checkbox" checked={onlyUnsyncedCategories} onChange={(event) => setOnlyUnsyncedCategories(event.target.checked)} />
              Sin sincronizar
            </label>
          </div>

          <div className="cost-config-table-status">
            <span>{filteredConfigCategories.length === categories.length ? `${categories.length} categorías` : `${filteredConfigCategories.length} de ${categories.length} categorías`}</span>
            {(categoryConfigQuery || categoryStatusFilter || onlyUnsyncedCategories) && (
              <button className="button ghost small-button" type="button" onClick={() => { setCategoryConfigQuery(""); setCategoryStatusFilter(""); setOnlyUnsyncedCategories(false); }}>
                Limpiar filtros
              </button>
            )}
          </div>

          {loading ? (
            <div className="cost-channel-skeleton"><span /><span /><span /></div>
          ) : (
            <div className="table-wrap cost-config-table-wrap">
              <table className="cost-config-table category-table">
                <thead>
                  <tr>
                    <th><ConfigCategorySortButton column="category">Categoría</ConfigCategorySortButton></th>
                    <th className="numeric-header"><ConfigCategorySortButton column="marketplaceFeeRate">Comisión</ConfigCategorySortButton></th>
                    <th>Categorías ML</th>
                    <th><ConfigCategorySortButton column="sync">Sync ML</ConfigCategorySortButton></th>
                    <th><ConfigCategorySortButton column="active">Estado</ConfigCategorySortButton></th>
                    <th>Notas</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredConfigCategories.map((item) => {
                    const mlNames = listLabel(item.meli_category_names);
                    return (
                      <tr key={item.id || item.category}>
                        <td><strong className="cost-config-category-name">{item.category}</strong></td>
                        <td className="numeric-cell">{tablePercent(item.marketplace_fee_rate)}</td>
                        <td><span className="cost-config-clamp" title={mlNames}>{mlNames}</span></td>
                        <td>{item.meli_last_sync_at ? <span>{dateLabel(item.meli_last_sync_at)}</span> : <span className="cost-config-muted">Sin sincronizar</span>}</td>
                        <td><StatusBadge active={Boolean(item.active)} activeLabel="Activa" inactiveLabel="Inactiva" /></td>
                        <td><span className="cost-config-clamp" title={item.notes || "-"}>{item.notes || "-"}</span></td>
                        <td>
                          <div className="cost-config-actions">
                            <button className="button ghost small-button" onClick={() => editCategory(item)}><Pencil aria-hidden="true" />Editar</button>
                            <button className="button danger small-button" onClick={() => deleteCategory(item)} title={`Eliminar ${item.category}`}><Trash2 aria-hidden="true" />Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredConfigCategories.length === 0 && <tr><td colSpan={7}>No hay categorías que coincidan con los filtros.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {showCategoryImport && (
        <section className="card channel-card channel-editor-card meli-category-import-card" style={{ marginBottom: 20 }}>
          <div className="section-title-row">
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Importar categorías desde MercadoLibre</h2>
              <p className="small" style={{ marginBottom: 0 }}>
                Trae las categorías con publicaciones activas o pausadas, calcula la comisión detectada y te deja elegir cuáles guardar.
              </p>
            </div>
            <div className="channel-actions-buttons">
              <button type="button" className="button ghost" onClick={loadCategoryImportPreview} disabled={categoryImportLoading}>
                {categoryImportLoading ? "Actualizando..." : "Actualizar lista"}
              </button>
              <button type="button" className="button ghost" onClick={() => setShowCategoryImport(false)}>
                Cerrar
              </button>
            </div>
          </div>

          {categoryImportPreview && (
            <div className="category-import-summary">
              <span className="badge">{categoryImportPreview.total_categories} categorías ML</span>
              <span className="badge">{categoryImportPreview.total_items} publicaciones</span>
              <span className="badge">{categoryImportPreview.missing} nuevas</span>
              <span className="badge">{categoryImportPreview.existing} ya cargadas</span>
            </div>
          )}

          <div className="channel-actions-buttons category-import-actions">
            <button
              type="button"
              className="button ghost small-button"
              onClick={() => setSelectedCategoryIds((categoryImportPreview?.rows || []).filter((row) => !row.exists).map((row) => row.meli_category_id))}
              disabled={!categoryImportPreview || categoryImportLoading}
            >
              Seleccionar nuevas
            </button>
            <button
              type="button"
              className="button ghost small-button"
              onClick={() => setSelectedCategoryIds([])}
              disabled={selectedCategoryIds.length === 0}
            >
              Limpiar selección
            </button>
            <button
              type="button"
              className="button small-button"
              onClick={importSelectedCategories}
              disabled={categoryImportSaving || selectedCategoryIds.length === 0}
            >
              {categoryImportSaving ? "Importando..." : `Importar ${selectedCategoryIds.length}`}
            </button>
          </div>

          {categoryImportLoading && !categoryImportPreview ? <p>Cargando categorías desde MercadoLibre...</p> : (
            <div className="table-wrap category-import-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Importar</th>
                    <th>Nombre en la app</th>
                    <th>Categoría MercadoLibre</th>
                    <th>Publicaciones</th>
                    <th>Comisión</th>
                    <th>Estado</th>
                    <th>Ejemplos</th>
                  </tr>
                </thead>
                <tbody>
                  {(categoryImportPreview?.rows || []).map((row) => {
                    const selected = selectedCategoryIds.includes(row.meli_category_id);
                    return (
                      <tr key={row.meli_category_id}>
                        <td>
                          <label className="checkbox-row category-import-check">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(event) => toggleCategorySelection(row.meli_category_id, event.target.checked)}
                            />
                            <span>{selected ? "Sí" : "No"}</span>
                          </label>
                        </td>
                        <td>
                          <input
                            value={categoryImportNames[row.meli_category_id] || ""}
                            onChange={(event) => updateCategoryImportName(row.meli_category_id, event.target.value)}
                            placeholder={row.meli_category_name}
                          />
                        </td>
                        <td>
                          <strong>{row.meli_category_name}</strong>
                          <div className="small">{row.meli_category_path}</div>
                          <div className="small">{row.meli_category_id}</div>
                        </td>
                        <td>
                          <strong>{row.publication_count}</strong>
                          <div className="small">{row.active_publications} activas / {row.paused_publications} pausadas</div>
                        </td>
                        <td>{percent(row.marketplace_fee_rate)}</td>
                        <td>{row.exists ? <span className="badge">ya cargada</span> : <span className="badge">nueva</span>}</td>
                        <td>{row.sample_titles?.length ? row.sample_titles.join(" | ") : "-"}</td>
                      </tr>
                    );
                  })}
                  {!categoryImportLoading && (!categoryImportPreview || categoryImportPreview.rows.length === 0) && (
                    <tr><td colSpan={7}>No encontramos categorías con publicaciones en MercadoLibre.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {showChannelForm && (
        <section className="card channel-card channel-editor-card" style={{ marginBottom: 20 }}>
          <div className="section-title-row">
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Condiciones de venta / canales</h2>
              <p className="small" style={{ marginBottom: 0 }}>Configurá canales como MercadoLibre, efectivo, transferencia, Tienda Nube, Posnet u otros. Los checks definen qué costos/impuestos aplican en el cálculo.</p>
            </div>
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setShowChannelForm(false);
                setInstallmentForm(emptyInstallment);
              }}
            >
              Cerrar
            </button>
          </div>
          <form onSubmit={saveInstallment}>
            <div className="channel-form-grid">
              <div className="field"><label>Código *</label><input value={installmentForm.code} onChange={(e) => updateInstallment("code", e.target.value)} placeholder="EF, MP6, TN" required /></div>
              <div className="field"><label>Nombre *</label><input value={installmentForm.name} onChange={(e) => updateInstallment("name", e.target.value)} placeholder="Efectivo / ML Premium 6 cuotas" required /></div>
              <div className="field"><label>Tipo de canal</label><select value={installmentForm.channel_type || "mercadolibre"} onChange={(e) => applyChannelPreset(e.target.value)}><option value="mercadolibre">MercadoLibre</option><option value="directo">Directo / efectivo</option><option value="web">Web / Tienda Nube</option><option value="posnet">Posnet</option><option value="otro">Otro</option></select></div>
              <div className="field"><label>Cuotas</label><input type="number" min="0" value={numberValue(installmentForm.installment_count)} onChange={(e) => updateInstallment("installment_count", toNumber(e.target.value))} /></div>
              <div className="field"><label>Costo canal / cuotas %</label><input type="number" step="0.01" value={installmentForm.financing_fee_rate} onChange={(e) => updateInstallment("financing_fee_rate", Number(e.target.value))} /></div>
              <div className="field"><label>Estado</label><select value={installmentForm.active ? "true" : "false"} onChange={(e) => updateInstallment("active", e.target.value === "true")}><option value="true">Activo</option><option value="false">Inactivo</option></select></div>
            </div>

            <div className="channel-flags">
              <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_marketplace_fee)} onChange={(e) => updateInstallment("applies_marketplace_fee", e.target.checked)} /><span>Aplica comisión ML por categoría</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_shipping)} onChange={(e) => updateInstallment("applies_shipping", e.target.checked)} /><span>Aplica envío ML</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_iibb)} onChange={(e) => updateInstallment("applies_iibb", e.target.checked)} /><span>Aplica IIBB</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_idc)} onChange={(e) => updateInstallment("applies_idc", e.target.checked)} /><span>Aplica IDC</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_iigg)} onChange={(e) => updateInstallment("applies_iigg", e.target.checked)} /><span>Aplica IIGG</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_structure)} onChange={(e) => updateInstallment("applies_structure", e.target.checked)} /><span>Aplica estructura</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={Boolean(installmentForm.applies_vat)} onChange={(e) => updateInstallment("applies_vat", e.target.checked)} /><span>Aplica IVA venta</span></label>
            </div>

            <div className="channel-footer">
              <div className="field channel-notes"><label>Notas</label><input value={installmentForm.notes || ""} onChange={(e) => updateInstallment("notes", e.target.value)} /></div>
              <button className="button" disabled={saving}>{saving ? "Guardando..." : "Guardar canal"}</button>
            </div>
          </form>
        </section>
      )}

      {showCategoryForm && (
        <section className="card channel-card channel-editor-card" style={{ marginBottom: 20 }}>
          <div className="section-title-row">
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Comisiones por categoría / canal</h2>
              <p className="small" style={{ marginBottom: 0 }}>Esta comisión cambia según la categoría del producto y se usa solo en canales que tengan activo "Aplica comisión ML por categoría".</p>
            </div>
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setShowCategoryForm(false);
                setCategoryForm(emptyCategory);
              }}
            >
              Cerrar
            </button>
          </div>
          <form onSubmit={saveCategory}>
            <div className="category-form-grid">
              <div className="field"><label>Categoría *</label><input value={categoryForm.category} onChange={(e) => updateCategory("category", e.target.value)} placeholder="TV" required /></div>
              <div className="field"><label>Comisión MercadoLibre %</label><input type="number" step="0.01" value={categoryForm.marketplace_fee_rate} onChange={(e) => updateCategory("marketplace_fee_rate", Number(e.target.value))} /></div>
              <div className="field"><label>Estado</label><select value={categoryForm.active ? "true" : "false"} onChange={(e) => updateCategory("active", e.target.value === "true")}><option value="true">Activa</option><option value="false">Inactiva</option></select></div>
              <div className="field"><label>Notas</label><input value={categoryForm.notes || ""} onChange={(e) => updateCategory("notes", e.target.value)} /></div>
            </div>
            <button className="button" disabled={saving} style={{ marginTop: 14 }}>{saving ? "Guardando..." : "Guardar categoría"}</button>
          </form>
        </section>
      )}

    </main>
  );
}
