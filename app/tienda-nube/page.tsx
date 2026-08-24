"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ExternalLink, Globe2, Image as ImageIcon, Plus, RefreshCw, Save, Search, Store, Trash2, Upload } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { createClient } from "@/lib/supabase";
import {
  calculatePriceSummary,
  defaultTaxSettings,
  moneyWithCents,
  normalizeOption,
  percent,
} from "@/lib/pricing";
import type {
  MercadoLibreCategoryFee,
  MercadoLibreInstallmentFee,
  MercadoLibreShippingCost,
  Product,
  ProductChannelMargin,
  TaxSettings,
  TiendanubePublication,
  TiendanubeWebBanner,
} from "@/lib/types";

type SortKey = "sku" | "name" | "price" | "suggested" | "diff" | "margin" | "stock" | "status";
type SortDirection = "asc" | "desc";
type StatusFilter = "" | "ok" | "needs_price" | "missing" | "unlinked";
type TiendaNubeTab = "prices" | "web";
type BannerImageVariant = "desktop" | "mobile";

type TnStatus = {
  connected: boolean;
  configured?: boolean;
  missingConfig?: string[];
  account?: {
    store_id: number;
    store_name?: string | null;
    scope?: string | null;
    updated_at?: string | null;
  } | null;
};

type Row = {
  key: string;
  product: Product | null;
  publication: TiendanubePublication | null;
  sku: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  stock: number;
  currentPrice: number | null;
  suggestedPrice: number | null;
  diff: number | null;
  diffRate: number | null;
  margin: number | null;
  netProfit: number | null;
  status: "ok" | "needs_price" | "missing" | "unlinked";
  statusLabel: string;
};

type BannerForm = {
  id?: string;
  position: number;
  title: string;
  subtitle: string;
  image_url: string;
  mobile_image_url: string;
  link_url: string;
  button_label: string;
  text_color: string;
  overlay_opacity: number;
  active: boolean;
  starts_at: string;
  ends_at: string;
};

const emptyBannerForm: BannerForm = {
  position: 0,
  title: "",
  subtitle: "",
  image_url: "",
  mobile_image_url: "",
  link_url: "",
  button_label: "Comprar ahora",
  text_color: "#ffffff",
  overlay_opacity: 0.28,
  active: true,
  starts_at: "",
  ends_at: "",
};

const bannerImageSpecs: Record<BannerImageVariant, { label: string; width: number; height: number; field: "image_url" | "mobile_image_url" }> = {
  desktop: { label: "Desktop", width: 1580, height: 600, field: "image_url" },
  mobile: { label: "Mobile", width: 820, height: 1200, field: "mobile_image_url" },
};

function normalizeSku(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusBadgeClass(status: Row["status"]) {
  if (status === "ok") return "tn-status-ok";
  if (status === "needs_price") return "tn-status-warning";
  if (status === "missing") return "tn-status-missing";
  return "tn-status-unlinked";
}

function shortDate(value?: string | null) {
  if (!value) return "Sin sincronizar";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function latestSyncedPublications(publications: MercadoLibreShippingCost[]) {
  const synced = publications
    .map((publication) => ({
      publication,
      time: new Date(publication.meli_last_sync_at || publication.updated_at || 0).getTime(),
    }))
    .filter((item) => Number.isFinite(item.time) && item.time > 0);
  if (!synced.length) return publications;

  const latest = Math.max(...synced.map((item) => item.time));
  const syncWindowMs = 10 * 60 * 1000;
  return synced
    .filter((item) => latest - item.time <= syncWindowMs)
    .map((item) => item.publication);
}

function productImage(publications: MercadoLibreShippingCost[]) {
  return publications.find((publication) => Boolean(publication.meli_thumbnail))?.meli_thumbnail || null;
}

function fallbackTiendaNubeOption(): MercadoLibreInstallmentFee {
  return {
    code: "TN",
    name: "Tienda Nube",
    channel_type: "web",
    installment_count: null,
    financing_fee_rate: 0,
    applies_marketplace_fee: false,
    applies_shipping: false,
    applies_iibb: true,
    applies_idc: true,
    applies_iigg: true,
    applies_structure: true,
    applies_vat: true,
    active: true,
  };
}

function ProductThumb({ src, label }: { src: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="rotation-product-thumb">
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : label.slice(0, 2).toUpperCase()}
    </div>
  );
}

function dateInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function bannerToForm(banner: TiendanubeWebBanner): BannerForm {
  return {
    id: banner.id,
    position: Number(banner.position || 0),
    title: banner.title || "",
    subtitle: banner.subtitle || "",
    image_url: banner.image_url || "",
    mobile_image_url: banner.mobile_image_url || "",
    link_url: banner.link_url || "",
    button_label: banner.button_label || "",
    text_color: banner.text_color || "#ffffff",
    overlay_opacity: Number(banner.overlay_opacity ?? 0.28),
    active: Boolean(banner.active),
    starts_at: dateInputValue(banner.starts_at),
    ends_at: dateInputValue(banner.ends_at),
  };
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function imageSize(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(size);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo validar el tamaño de la imagen."));
    };
    image.src = url;
  });
}

export default function TiendaNubePage() {
  const router = useRouter();
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<TiendaNubeTab>("prices");
  const [status, setStatus] = useState<TnStatus | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<TiendanubePublication[]>([]);
  const [webBanners, setWebBanners] = useState<TiendanubeWebBanner[]>([]);
  const [bannerForm, setBannerForm] = useState<BannerForm>(emptyBannerForm);
  const [meliPublications, setMeliPublications] = useState<MercadoLibreShippingCost[]>([]);
  const [options, setOptions] = useState<MercadoLibreInstallmentFee[]>([]);
  const [categoryFees, setCategoryFees] = useState<MercadoLibreCategoryFee[]>([]);
  const [margins, setMargins] = useState<ProductChannelMargin[]>([]);
  const [taxes, setTaxes] = useState<TaxSettings>(defaultTaxSettings());
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [onlyWithStock, setOnlyWithStock] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("diff");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingBanner, setSavingBanner] = useState(false);
  const [uploadingBannerImage, setUploadingBannerImage] = useState<BannerImageVariant | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) router.push("/login");
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    const [
      statusResponse,
      productsResponse,
      publicationsResponse,
      meliPublicationsResponse,
      optionsResponse,
      categoryFeesResponse,
      marginsResponse,
      taxesResponse,
      bannersResponse,
    ] = await Promise.all([
      fetch("/api/tiendanube/status").then((response) => response.json()),
      supabase.from("products").select("*").in("status", ["active", "paused"]).order("sku", { ascending: true }),
      supabase.from("tiendanube_publications").select("*").eq("active", true).order("sku", { ascending: true }),
      supabase.from("mercadolibre_shipping_costs").select("*").eq("active", true),
      supabase.from("mercadolibre_installment_fees").select("*").eq("active", true),
      supabase.from("mercadolibre_category_fees").select("*").eq("active", true),
      supabase.from("product_channel_margins").select("*"),
      supabase.from("tax_settings").select("*").eq("key", "default").maybeSingle(),
      fetch("/api/tiendanube/web-banners").then((response) => response.json()),
    ]);

    setLoading(false);
    if (statusResponse?.error) setError(statusResponse.error);
    else setStatus(statusResponse as TnStatus);
    if (productsResponse.error) setError(productsResponse.error.message);
    else setProducts((productsResponse.data || []) as Product[]);
    if (publicationsResponse.error) setError(publicationsResponse.error.message);
    else setPublications((publicationsResponse.data || []) as TiendanubePublication[]);
    if (meliPublicationsResponse.error) setError(meliPublicationsResponse.error.message);
    else setMeliPublications((meliPublicationsResponse.data || []) as MercadoLibreShippingCost[]);
    if (optionsResponse.error) setError(optionsResponse.error.message);
    else setOptions((optionsResponse.data || []) as MercadoLibreInstallmentFee[]);
    if (categoryFeesResponse.error) setError(categoryFeesResponse.error.message);
    else setCategoryFees((categoryFeesResponse.data || []) as MercadoLibreCategoryFee[]);
    if (marginsResponse.error) setError(marginsResponse.error.message);
    else setMargins((marginsResponse.data || []) as ProductChannelMargin[]);
    if (!taxesResponse.error && taxesResponse.data) setTaxes(taxesResponse.data as TaxSettings);
    if (bannersResponse?.error) setError(bannersResponse.error);
    else setWebBanners((bannersResponse?.banners || []) as TiendanubeWebBanner[]);
  }

  useEffect(() => {
    checkSession();
    loadData();
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("tn_connected");
    const tnError = params.get("tn_error");
    if (connected) setMessage("Tienda Nube conectada.");
    if (tnError) setError(tnError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tnOption = useMemo(() => {
    const found = options.find((option) => option.code.toUpperCase() === "TN") ||
      options.find((option) => option.channel_type === "web" && option.name.toLowerCase().includes("tienda"));
    return normalizeOption(found || fallbackTiendaNubeOption());
  }, [options]);

  const categories = useMemo(() => {
    return [...new Set(products.map((product) => product.category).filter(Boolean) as string[])]
      .sort((a, b) => a.localeCompare(b, "es"));
  }, [products]);

  const rows = useMemo<Row[]>(() => {
    const productById = new Map(products.filter((product) => product.id).map((product) => [product.id as string, product]));
    const productBySku = new Map(products.map((product) => [normalizeSku(product.sku), product]));
    const publicationsBySku = new Map<string, TiendanubePublication[]>();
    const meliPublicationsBySku = new Map<string, MercadoLibreShippingCost[]>();
    const linkedPublicationKeys = new Set<string>();

    publications.forEach((publication) => {
      const sku = normalizeSku(publication.sku || productById.get(publication.product_id || "")?.sku);
      if (!sku) return;
      publicationsBySku.set(sku, [...(publicationsBySku.get(sku) || []), publication]);
    });
    meliPublications.forEach((publication) => {
      const product = productById.get(publication.product_id || "");
      const sku = normalizeSku(publication.sku || product?.sku);
      if (!sku) return;
      meliPublicationsBySku.set(sku, [...(meliPublicationsBySku.get(sku) || []), publication]);
    });

    const productRows = products.flatMap((product) => {
      const sku = normalizeSku(product.sku);
      const publication = (publicationsBySku.get(sku) || [])[0] || null;
      if (product.status !== "active" && !publication) return [];
      const skuMeliPublications = meliPublicationsBySku.get(sku) || [];
      const latestMeliPublications = latestSyncedPublications(skuMeliPublications);
      const activeMeliPublications = latestMeliPublications.filter((item) => item.meli_status === "active");
      const stockSourcePublications = activeMeliPublications.length ? activeMeliPublications : latestMeliPublications;
      const stockFromMl = stockSourcePublications.length
        ? Math.max(...stockSourcePublications.map((item) => numberValue(item.meli_stock)))
        : 0;
      if (publication?.id) linkedPublicationKeys.add(publication.id);
      const categoryFee = categoryFees.find((item) => item.category?.toLowerCase() === (product.category || "").toLowerCase()) || null;
      const setting = margins.find((item) => item.product_id === product.id && item.channel_code.toUpperCase() === "TN");
      const desiredMargin = Number(setting?.desired_margin_rate ?? 5);
      const suggested = calculatePriceSummary(product, tnOption, categoryFee, taxes, null, {
        desiredMarginRate: desiredMargin,
        desiredNetProfit: setting?.desired_net_profit ?? null,
        structureAmount: setting?.structure_amount ?? null,
        manualShippingAmount: setting?.manual_shipping_amount ?? null,
        salesCommissionRate: setting?.sales_commission_rate ?? null,
        saleAppliesVat: setting?.sale_applies_vat ?? null,
        costVatRate: setting?.cost_vat_rate ?? null,
        roundTo: 100,
        roundingMode: "nearest",
      });
      const currentPrice = numberValue(publication?.promotional_price || publication?.price) || null;
      const current = currentPrice
        ? calculatePriceSummary(product, tnOption, categoryFee, taxes, null, {
            salePrice: currentPrice,
            structureAmount: setting?.structure_amount ?? null,
            manualShippingAmount: setting?.manual_shipping_amount ?? null,
            salesCommissionRate: setting?.sales_commission_rate ?? null,
            saleAppliesVat: setting?.sale_applies_vat ?? null,
            costVatRate: setting?.cost_vat_rate ?? null,
          })
        : null;
      const suggestedPrice = suggested.valid ? Number(suggested.roundedPrice || 0) : null;
      const diff = currentPrice && suggestedPrice ? currentPrice - suggestedPrice : null;
      const diffRate = diff !== null && suggestedPrice ? (diff / suggestedPrice) * 100 : null;
      const needsPrice = diffRate !== null && Math.abs(diffRate) >= 1;
      const status: Row["status"] = publication ? (needsPrice ? "needs_price" : "ok") : "missing";

      return [{
        key: `product-${sku}`,
        product,
        publication,
        sku,
        name: product.name,
        category: product.category || null,
        imageUrl: publication?.image_url || productImage(skuMeliPublications),
        stock: stockSourcePublications.length ? stockFromMl : numberValue(product.stock),
        currentPrice,
        suggestedPrice,
        diff,
        diffRate,
        margin: current?.valid ? Number(current.marginOnNetSale || 0) : null,
        netProfit: current?.valid ? Number(current.netProfit || 0) : null,
        status,
        statusLabel: status === "ok" ? "OK" : status === "needs_price" ? "Revisar precio" : "Falta en TN",
      }];
    });

    const unlinkedRows = publications
      .filter((publication) => publication.id && !linkedPublicationKeys.has(publication.id))
      .map((publication) => {
        const sku = normalizeSku(publication.sku);
        const product = sku ? productBySku.get(sku) || null : null;
        const skuMeliPublications = sku ? meliPublicationsBySku.get(sku) || [] : [];
        const latestMeliPublications = latestSyncedPublications(skuMeliPublications);
        const activeMeliPublications = latestMeliPublications.filter((item) => item.meli_status === "active");
        const stockSourcePublications = activeMeliPublications.length ? activeMeliPublications : latestMeliPublications;
        const stockFromMl = stockSourcePublications.length
          ? Math.max(...stockSourcePublications.map((item) => numberValue(item.meli_stock)))
          : 0;
        return {
          key: `publication-${publication.tiendanube_variant_id}`,
          product,
          publication,
          sku: sku || "-",
          name: publication.title || "Publicación sin nombre",
          category: product?.category || null,
          imageUrl: publication.image_url || productImage(skuMeliPublications),
          stock: stockSourcePublications.length ? stockFromMl : numberValue(publication.stock),
          currentPrice: numberValue(publication.promotional_price || publication.price) || null,
          suggestedPrice: null,
          diff: null,
          diffRate: null,
          margin: null,
          netProfit: null,
          status: "unlinked" as const,
          statusLabel: sku ? "Sin producto local" : "Sin SKU TN",
        };
      });

    return [...productRows, ...unlinkedRows];
  }, [categoryFees, margins, meliPublications, products, publications, taxes, tnOption]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (categoryFilter && row.category !== categoryFilter) return false;
        if (statusFilter && row.status !== statusFilter) return false;
        if (onlyWithStock && row.stock <= 0) return false;
        if (!q) return true;
        return `${row.sku} ${row.name} ${row.publication?.tiendanube_product_id || ""} ${row.publication?.tiendanube_variant_id || ""}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const direction = sortDirection === "asc" ? 1 : -1;
        const value = (row: Row) => {
          if (sortKey === "sku") return row.sku;
          if (sortKey === "name") return row.name;
          if (sortKey === "price") return row.currentPrice ?? -1;
          if (sortKey === "suggested") return row.suggestedPrice ?? -1;
          if (sortKey === "diff") return Math.abs(row.diffRate ?? 0);
          if (sortKey === "margin") return row.margin ?? -999;
          if (sortKey === "stock") return row.stock;
          return row.statusLabel;
        };
        const av = value(a);
        const bv = value(b);
        if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv), "es") * direction;
        return (Number(av) - Number(bv)) * direction;
      });
  }, [categoryFilter, onlyWithStock, query, rows, sortDirection, sortKey, statusFilter]);

  const metrics = useMemo(() => {
    const missing = rows.filter((row) => row.status === "missing").length;
    const needsPrice = rows.filter((row) => row.status === "needs_price").length;
    const ok = rows.filter((row) => row.status === "ok").length;
    const unlinked = rows.filter((row) => row.status === "unlinked").length;
    return { missing, needsPrice, ok, unlinked };
  }, [rows]);

  function changeSort(key: SortKey) {
    setSortKey((current) => {
      if (current === key) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection(key === "sku" || key === "name" ? "asc" : "desc");
      return key;
    });
  }

  async function syncProducts(successMessage?: string) {
    setSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/tiendanube/sync-products", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo sincronizar Tienda Nube.");
      setMessage(successMessage || `Tienda Nube: ${data.synced || 0} variantes sincronizadas, ${data.linked || 0} vinculadas por SKU.`);
      await loadData();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudo sincronizar Tienda Nube.");
    } finally {
      setSyncing(false);
    }
  }

  async function updatePrice(row: Row) {
    if (!row.publication || !row.suggestedPrice) return;
    setBusyKey(row.key);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/tiendanube/update-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: row.publication.tiendanube_product_id,
          variantId: row.publication.tiendanube_variant_id,
          price: row.suggestedPrice,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo actualizar el precio.");
      setMessage(`${row.sku}: precio actualizado en Tienda Nube.`);
      await syncProducts();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No se pudo actualizar el precio.");
    } finally {
      setBusyKey(null);
    }
  }

  async function createProduct(row: Row) {
    if (!row.product) {
      setMessage(null);
      setError(`${row.sku}: no puedo crear la publicación porque no encontré el producto local.`);
      return;
    }
    if (!row.suggestedPrice || row.suggestedPrice <= 0) {
      setMessage(null);
      setError(`${row.sku}: no puedo crear la publicación porque no hay precio sugerido TN. Revisá costo, margen y configuración del canal TN.`);
      return;
    }
    setBusyKey(row.key);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/tiendanube/create-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: row.sku, price: row.suggestedPrice, visibility: "hidden" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo crear la publicación.");
      const extras = [
        data?.categoryId ? "categoría asignada" : "sin categoría equivalente",
        data?.imageUrl ? "imagen cargada" : "sin imagen",
        data?.warning ? `aviso: ${data.warning}` : "",
      ].filter(Boolean);
      await syncProducts(`${row.sku}: producto creado en Tienda Nube como oculto (${extras.join(" · ")}).`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No se pudo crear la publicación.");
    } finally {
      setBusyKey(null);
    }
  }

  function editBanner(banner: TiendanubeWebBanner) {
    setBannerForm(bannerToForm(banner));
    setActiveTab("web");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearBannerForm() {
    setBannerForm({
      ...emptyBannerForm,
      position: webBanners.length ? Math.max(...webBanners.map((banner) => Number(banner.position || 0))) + 1 : 0,
    });
  }

  async function saveBanner() {
    setSavingBanner(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/tiendanube/web-banners", {
        method: bannerForm.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...bannerForm,
          starts_at: bannerForm.starts_at || null,
          ends_at: bannerForm.ends_at || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo guardar el banner.");
      setMessage("Banner guardado. La web lo toma desde el endpoint publicado.");
      clearBannerForm();
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el banner.");
    } finally {
      setSavingBanner(false);
    }
  }

  async function uploadBannerImage(file: File | undefined, variant: BannerImageVariant) {
    if (!file) return;
    const spec = bannerImageSpecs[variant];
    setUploadingBannerImage(variant);
    setMessage(null);
    setError(null);
    try {
      const size = await imageSize(file);
      const base64 = await fileToBase64(file);
      const response = await fetch("/api/tiendanube/web-banners/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variant,
          fileName: file.name,
          contentType: file.type,
          data: base64,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo subir la imagen.");
      setBannerForm((current) => ({ ...current, [spec.field]: data.url }));
      const matchesRecommended = size.width === spec.width && size.height === spec.height;
      setMessage(
        matchesRecommended
          ? `${spec.label}: imagen subida con medida recomendada ${spec.width} x ${spec.height}px.`
          : `${spec.label}: imagen subida (${size.width} x ${size.height}px). Recomendado: ${spec.width} x ${spec.height}px.`,
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No se pudo subir la imagen.");
    } finally {
      setUploadingBannerImage(null);
    }
  }

  async function deleteBanner(banner: TiendanubeWebBanner) {
    if (!banner.id) return;
    if (!window.confirm(`¿Eliminar el banner "${banner.title}"?`)) return;
    setSavingBanner(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/tiendanube/web-banners?id=${encodeURIComponent(banner.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo eliminar el banner.");
      setMessage("Banner eliminado.");
      await loadData();
      if (bannerForm.id === banner.id) clearBannerForm();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el banner.");
    } finally {
      setSavingBanner(false);
    }
  }

  const SortButton = ({ id, children }: { id: SortKey; children: React.ReactNode }) => (
    <button type="button" className="tn-sort-button" onClick={() => changeSort(id)}>
      {children}{sortKey === id ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <main className="container wide tienda-nube-page">
      <PageHero
        title="Tienda Nube"
        description="Publicaciones, precios sugeridos y acciones de sincronización usando el canal TN."
        icon={<Store aria-hidden="true" />}
        onRefresh={loadData}
        refreshLabel="Actualizar"
        actions={
          <>
            {status?.connected ? (
              <button type="button" className="button" onClick={() => syncProducts()} disabled={syncing}>
                <RefreshCw size={16} aria-hidden="true" />
                {syncing ? "Sincronizando..." : "Sincronizar TN"}
              </button>
            ) : status?.configured === false ? (
              <button type="button" className="button" disabled title="Faltan credenciales de Tienda Nube">
                <Upload size={16} aria-hidden="true" />
                Credenciales pendientes
              </button>
            ) : (
              <a className="button" href="/api/tiendanube/connect">
                <Upload size={16} aria-hidden="true" />
                Conectar TN
              </a>
            )}
          </>
        }
      />

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}
      {status && status.configured === false && (
        <div className="alert warning tn-setup-alert">
          Para conectar Tienda Nube faltan variables de entorno: <strong>{(status.missingConfig || []).join(", ")}</strong>.
          Configuralas en el deploy y volvé a abrir esta pantalla.
        </div>
      )}

      <section className="tn-tabs" aria-label="Secciones Tienda Nube">
        <button className={activeTab === "prices" ? "active" : ""} type="button" onClick={() => setActiveTab("prices")}>
          <Store size={16} aria-hidden="true" />
          Precios y stock
        </button>
        <button className={activeTab === "web" ? "active" : ""} type="button" onClick={() => setActiveTab("web")}>
          <Globe2 size={16} aria-hidden="true" />
          Página web
        </button>
      </section>

      {activeTab === "prices" ? (
      <>
      <section className="rentabilidad-kpi-grid tn-kpis">
        <article className="card rentabilidad-kpi-card promo">
          <span>Cuenta</span>
          <strong>{status?.connected ? `Store ${status.account?.store_id}` : "Sin conectar"}</strong>
          <small>{status?.account?.scope || "Permisos pendientes"}</small>
        </article>
        <article className="card rentabilidad-kpi-card">
          <span>OK</span>
          <strong>{metrics.ok}</strong>
          <small>Dentro de tolerancia</small>
        </article>
        <article className="card rentabilidad-kpi-card warning">
          <span>Revisar precio</span>
          <strong>{metrics.needsPrice}</strong>
          <small>Diferencia mayor a 1%</small>
        </article>
        <article className="card rentabilidad-kpi-card missing">
          <span>Faltan en TN</span>
          <strong>{metrics.missing}</strong>
          <small>{metrics.unlinked} sin producto local</small>
        </article>
      </section>

      <section className="card rentabilidad-filters-card tn-toolbar-card">
        <div className="rentabilidad-filter-grid tn-toolbar">
          <label className="search-control">
            <Search aria-hidden="true" />
            <input className="search-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, producto o ID Tienda Nube" />
          </label>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((category) => <option value={category} key={category}>{category}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="">Todos los estados</option>
            <option value="needs_price">Revisar precio</option>
            <option value="missing">Falta en TN</option>
            <option value="unlinked">Sin producto local</option>
            <option value="ok">OK</option>
          </select>
          <label className={`rotation-filter-chip ${onlyWithStock ? "active" : ""}`}>
            <input type="checkbox" checked={onlyWithStock} onChange={(event) => setOnlyWithStock(event.target.checked)} />
            {onlyWithStock && <Check aria-hidden="true" />}
            Con stock
          </label>
        </div>
      </section>

      <section className="card rentabilidad-table-card tn-table-card">
        <div className="rentabilidad-table-header tn-table-header">
          <div>
            <h2>Publicaciones Tienda Nube</h2>
            <p>{loading ? "Cargando..." : `${filteredRows.length} de ${rows.length} filas · canal ${tnOption.code}`}</p>
          </div>
          <span className="badge">Últ. sync {shortDate(publications[0]?.tn_last_sync_at)}</span>
        </div>
        <div className="tn-table-wrap">
          <table className="rentabilidad-table tn-table">
            <thead>
              <tr>
                <th><SortButton id="name">Producto</SortButton></th>
                <th><SortButton id="status">Estado</SortButton></th>
                <th className="numeric-header"><SortButton id="price">TN actual</SortButton></th>
                <th className="numeric-header"><SortButton id="suggested">Sugerido TN</SortButton></th>
                <th className="numeric-header"><SortButton id="diff">Diferencia</SortButton></th>
                <th className="numeric-header"><SortButton id="margin">Margen actual</SortButton></th>
                <th className="numeric-header"><SortButton id="stock">Stock</SortButton></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <div className="rentabilidad-product-cell tn-product-cell">
                      <ProductThumb src={row.imageUrl} label={row.name || row.sku} />
                      <div>
                        <strong>{row.name}</strong>
                        <span>{row.sku} · {row.category || "Sin categoría"}</span>
                        {row.publication && <small>TN {row.publication.tiendanube_product_id} / Var {row.publication.tiendanube_variant_id}</small>}
                      </div>
                    </div>
                  </td>
                  <td><span className={`tn-status ${statusBadgeClass(row.status)}`}>{row.statusLabel}</span></td>
                  <td className="numeric-cell">{moneyWithCents(row.currentPrice)}</td>
                  <td className="numeric-cell"><strong>{moneyWithCents(row.suggestedPrice)}</strong></td>
                  <td className={`numeric-cell ${row.diff !== null && row.diff < 0 ? "negative-money" : ""}`}>
                    <strong>{moneyWithCents(row.diff)}</strong>
                    <small>{row.diffRate !== null ? percent(row.diffRate) : "-"}</small>
                  </td>
                  <td className={`numeric-cell ${row.margin !== null && row.margin < 0 ? "negative-money" : "positive-money"}`}>
                    <strong>{row.margin !== null ? percent(row.margin) : "-"}</strong>
                    <small>{moneyWithCents(row.netProfit)}</small>
                  </td>
                  <td className="numeric-cell">{row.stock}</td>
                  <td>
                    <div className="tn-actions">
                      {row.publication?.permalink && (
                        <a className="button ghost small-button" href={row.publication.permalink} target="_blank" rel="noreferrer" title="Abrir publicación">
                          <ExternalLink size={14} aria-hidden="true" />
                        </a>
                      )}
                      {row.status === "needs_price" && (
                        <button className="button small-button" type="button" onClick={() => updatePrice(row)} disabled={busyKey === row.key || !row.suggestedPrice}>
                          <Check size={14} aria-hidden="true" />
                          Ajustar
                        </button>
                      )}
                      {row.status === "missing" && (
                        <button
                          className="button small-button"
                          type="button"
                          onClick={() => createProduct(row)}
                          disabled={busyKey === row.key}
                          title={!row.suggestedPrice ? "No hay precio sugerido TN para crear esta publicación" : "Crear producto en Tienda Nube"}
                        >
                          <Plus size={14} aria-hidden="true" />
                          {busyKey === row.key ? "Creando..." : "Crear"}
                        </button>
                      )}
                      {row.status === "unlinked" && <AlertTriangle size={18} className="tn-warning-icon" aria-label={row.statusLabel} />}
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredRows.length && (
                <tr>
                  <td colSpan={8}>
                    <div className="tn-empty">No hay filas para los filtros actuales.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      </>
      ) : (
      <section className="tn-web-grid">
        <article className="card tn-banner-editor">
          <div className="tn-section-head">
            <div>
              <h2>{bannerForm.id ? "Editar banner" : "Nuevo banner"}</h2>
              <p>Cambios visibles desde el script público de la tienda.</p>
            </div>
            <button className="button ghost small-button" type="button" onClick={clearBannerForm}>Limpiar</button>
          </div>

          <div className="tn-banner-form">
            <label>
              <span>Título</span>
              <input value={bannerForm.title} onChange={(event) => setBannerForm((current) => ({ ...current, title: event.target.value }))} placeholder="Cyber Week ADARA" />
            </label>
            <label>
              <span>Subtítulo</span>
              <input value={bannerForm.subtitle} onChange={(event) => setBannerForm((current) => ({ ...current, subtitle: event.target.value }))} placeholder="Tablets, notebooks y accesorios seleccionados" />
            </label>
            <div className="tn-banner-upload-field">
              <span>Imagen desktop</span>
              <small>Tamaño recomendado: 1580 x 600 px</small>
              <label className="tn-banner-upload-box">
                <Upload size={18} aria-hidden="true" />
                {uploadingBannerImage === "desktop" ? "Subiendo..." : "Elegir imagen desktop"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => uploadBannerImage(event.target.files?.[0], "desktop")} />
              </label>
              <input value={bannerForm.image_url} onChange={(event) => setBannerForm((current) => ({ ...current, image_url: event.target.value }))} placeholder="URL imagen desktop" />
            </div>
            <div className="tn-banner-upload-field">
              <span>Imagen mobile</span>
              <small>Tamaño recomendado: 820 x 1200 px</small>
              <label className="tn-banner-upload-box">
                <Upload size={18} aria-hidden="true" />
                {uploadingBannerImage === "mobile" ? "Subiendo..." : "Elegir imagen mobile"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => uploadBannerImage(event.target.files?.[0], "mobile")} />
              </label>
              <input value={bannerForm.mobile_image_url} onChange={(event) => setBannerForm((current) => ({ ...current, mobile_image_url: event.target.value }))} placeholder="URL imagen mobile opcional" />
            </div>
            <label>
              <span>Link</span>
              <input value={bannerForm.link_url} onChange={(event) => setBannerForm((current) => ({ ...current, link_url: event.target.value }))} placeholder="/productos?mpage=2 o https://..." />
            </label>
            <label>
              <span>Botón</span>
              <input value={bannerForm.button_label} onChange={(event) => setBannerForm((current) => ({ ...current, button_label: event.target.value }))} placeholder="Comprar ahora" />
            </label>
            <label>
              <span>Orden</span>
              <input type="number" value={bannerForm.position} onChange={(event) => setBannerForm((current) => ({ ...current, position: Number(event.target.value || 0) }))} />
            </label>
            <label>
              <span>Color texto</span>
              <input type="color" value={bannerForm.text_color} onChange={(event) => setBannerForm((current) => ({ ...current, text_color: event.target.value }))} />
            </label>
            <label>
              <span>Oscurecer imagen</span>
              <input type="range" min="0" max="0.75" step="0.01" value={bannerForm.overlay_opacity} onChange={(event) => setBannerForm((current) => ({ ...current, overlay_opacity: Number(event.target.value) }))} />
            </label>
            <label>
              <span>Inicio</span>
              <input type="datetime-local" value={bannerForm.starts_at} onChange={(event) => setBannerForm((current) => ({ ...current, starts_at: event.target.value }))} />
            </label>
            <label>
              <span>Fin</span>
              <input type="datetime-local" value={bannerForm.ends_at} onChange={(event) => setBannerForm((current) => ({ ...current, ends_at: event.target.value }))} />
            </label>
            <label className="tn-banner-check">
              <input type="checkbox" checked={bannerForm.active} onChange={(event) => setBannerForm((current) => ({ ...current, active: event.target.checked }))} />
              <span>Activo en la web</span>
            </label>
          </div>

          <div className="tn-banner-preview">
            {bannerForm.image_url ? <img src={bannerForm.image_url} alt="" /> : <div><ImageIcon aria-hidden="true" />Sin imagen</div>}
            <span style={{ background: `rgba(0,0,0,${bannerForm.overlay_opacity})` }} />
            <div style={{ color: bannerForm.text_color }}>
              <h3>{bannerForm.title || "Título de campaña"}</h3>
              <p>{bannerForm.subtitle || "Subtítulo opcional del banner"}</p>
              {bannerForm.button_label ? <strong>{bannerForm.button_label}</strong> : null}
            </div>
          </div>

          <button className="button tn-save-banner" type="button" onClick={saveBanner} disabled={savingBanner}>
            <Save size={16} aria-hidden="true" />
            {savingBanner ? "Guardando..." : bannerForm.id ? "Guardar cambios" : "Crear banner"}
          </button>
        </article>

        <article className="card tn-banner-list-card">
          <div className="tn-section-head">
            <div>
              <h2>Banners cargados</h2>
              <p>{webBanners.length} banner{webBanners.length === 1 ? "" : "s"} configurado{webBanners.length === 1 ? "" : "s"}</p>
            </div>
            <span className="badge">Script público</span>
          </div>
          <div className="tn-script-box">
            <code>{`<script src="https://pricing-adara-online.vercel.app/api/tiendanube/web-banners/script.js"></script>`}</code>
          </div>
          <div className="tn-banner-list">
            {webBanners.map((banner) => (
              <div className="tn-banner-item" key={banner.id}>
                <img src={banner.image_url} alt="" />
                <div>
                  <strong>{banner.title}</strong>
                  <span>{banner.active ? "Activo" : "Pausado"} · orden {banner.position}</span>
                  <small>{banner.link_url || "Sin link"}</small>
                </div>
                <button className="button ghost small-button" type="button" onClick={() => editBanner(banner)}>Editar</button>
                <button className="button ghost small-button tn-danger-button" type="button" onClick={() => deleteBanner(banner)} title="Eliminar banner">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
            {!webBanners.length && <div className="tn-empty">Todavía no hay banners cargados.</div>}
          </div>
        </article>
      </section>
      )}
    </main>
  );
}
