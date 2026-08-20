export type ProductStatus = "active" | "paused" | "discontinued";

export type Product = {
  id?: string;
  sku: string;
  ean?: string | null;
  name: string;
  description?: string | null;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  cost_without_vat: number;
  vat_rate: 21 | 10.5;
  cost_with_vat?: number;
  weight_kg?: number | null;
  height_cm?: number | null;
  width_cm?: number | null;
  depth_cm?: number | null;
  stock?: number | null;
  supplier?: string | null;
  warranty_months?: number | null;
  status: ProductStatus;
  created_at?: string;
  updated_at?: string;
};

export type RoundingMode = "nearest" | "up" | "down";

export type ChannelType =
  | "mercadolibre"
  | "directo"
  | "web"
  | "posnet"
  | "otro";

export type MercadoLibreInstallmentFee = {
  id?: string;
  code: string;
  name: string;
  channel_type?: ChannelType | string | null;
  installment_count?: number | null;
  financing_fee_rate: number;
  applies_marketplace_fee?: boolean | null;
  applies_shipping?: boolean | null;
  applies_iibb?: boolean | null;
  applies_idc?: boolean | null;
  applies_iigg?: boolean | null;
  applies_structure?: boolean | null;
  applies_vat?: boolean | null;
  active: boolean;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type MercadoLibrePriceOption = {
  code: string;
  name: string;
  channel_type?: ChannelType | string | null;
  installment_count?: number | null;
  financing_fee_rate: number;
  applies_marketplace_fee?: boolean | null;
  applies_shipping?: boolean | null;
  applies_iibb?: boolean | null;
  applies_idc?: boolean | null;
  applies_iigg?: boolean | null;
  applies_structure?: boolean | null;
  applies_vat?: boolean | null;
  active?: boolean;
};

export type MercadoLibreCategoryFee = {
  id?: string;
  category: string;
  marketplace_fee_rate: number;
  active: boolean;
  meli_category_ids?: string[] | null;
  meli_category_names?: string[] | null;
  meli_source?: string | null;
  meli_last_sync_at?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type MercadoLibreShippingCost = {
  id?: string;
  product_id: string;
  sku?: string | null;
  fixed_fee_amount: number;
  shipping_cost_amount: number;
  free_shipping: boolean;
  shipping_method?: string | null;
  notes?: string | null;
  active: boolean;
  meli_item_id?: string | null;
  meli_thumbnail?: string | null;
  meli_title?: string | null;
  meli_permalink?: string | null;
  meli_price?: number | null;
  meli_currency_id?: string | null;
  meli_original_price?: number | null;
  meli_promo_price?: number | null;
  meli_promo_name?: string | null;
  meli_promo_status?: string | null;
  meli_promo_discount_amount?: number | null;
  meli_promo_discount_rate?: number | null;
  meli_promo_seller_amount?: number | null;
  meli_promo_seller_rate?: number | null;
  meli_promo_meli_amount?: number | null;
  meli_promo_meli_rate?: number | null;
  meli_promo_receive_amount?: number | null;
  meli_promotions?: unknown[] | null;
  meli_listing_type_id?: string | null;
  meli_listing_type_name?: string | null;
  meli_sale_fee_amount?: number | null;
  meli_sale_fee_details?: Record<string, unknown> | null;
  meli_financing_fee_rate?: number | null;
  meli_sale_terms?: unknown[] | null;
  meli_tags?: string[] | null;
  meli_installments_text?: string | null;
  meli_catalog_listing?: boolean | null;
  meli_catalog_product_id?: string | null;
  meli_domain_id?: string | null;
  meli_catalog_status?: string | null;
  meli_catalog_price_to_win?: number | null;
  meli_catalog_current_price?: number | null;
  meli_catalog_consistent?: boolean | null;
  meli_catalog_visit_share?: string | null;
  meli_catalog_competitors_sharing_first_place?: number | null;
  meli_catalog_reason?: string[] | null;
  meli_status?: string | null;
  meli_stock?: number | null;
  meli_free_shipping?: boolean | null;
  meli_shipping_mode?: string | null;
  meli_logistic_type?: string | null;
  meli_cost_source?: string | null;
  meli_last_sync_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type MercadoLibrePromotionOpportunity = {
  id?: string;
  created_at?: string;
  updated_at?: string;
  last_sync_at?: string | null;
  promotion_id: string;
  promotion_name?: string | null;
  promotion_type?: string | null;
  promotion_status?: string | null;
  item_promotion_status?: string | null;
  offer_id?: string | null;
  meli_item_id: string;
  original_price?: number | null;
  promo_price?: number | null;
  min_discounted_price?: number | null;
  max_discounted_price?: number | null;
  suggested_discounted_price?: number | null;
  seller_percentage?: number | null;
  meli_percentage?: number | null;
  seller_amount?: number | null;
  meli_amount?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  raw?: unknown;
};

export type MercadoLibreOrderItem = {
  id?: string;
  order_id: string;
  order_date: string;
  status?: string | null;
  pack_id?: string | null;
  meli_item_id: string;
  variation_id?: string | null;
  sku: string;
  product_id?: string | null;
  title?: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  currency_id?: string | null;
  listing_type_id?: string | null;
  sale_fee_amount?: number | null;
  gross_price?: number | null;
  actual_installments?: number | null;
  payment_method_id?: string | null;
  normalized_option_code?: string | null;
  normalized_unit_price?: number | null;
  normalized_net_sale_price?: number | null;
  normalized_net_profit?: number | null;
  normalized_total_net_profit?: number | null;
  normalized_margin_on_net_sale?: number | null;
  normalized_margin_on_cost?: number | null;
  normalized_cost_for_profit?: number | null;
  normalized_product_cost_without_vat?: number | null;
  normalized_product_vat_rate?: number | null;
  normalized_marketplace_fee_amount?: number | null;
  normalized_shipping_cost_amount?: number | null;
  normalized_fixed_fee_amount?: number | null;
  normalized_income_tax_amount?: number | null;
  normalized_profit_error?: string | null;
  profitability_calculated_at?: string | null;
  raw?: unknown;
  created_at?: string;
  updated_at?: string;
};

export type TiendanubePublication = {
  id?: string;
  tiendanube_store_id: number;
  tiendanube_product_id: number;
  tiendanube_variant_id: number;
  product_id?: string | null;
  sku?: string | null;
  title?: string | null;
  variant_name?: string | null;
  handle?: string | null;
  permalink?: string | null;
  price?: number | null;
  promotional_price?: number | null;
  currency?: string | null;
  stock?: number | null;
  stock_management?: boolean | null;
  visibility?: string | null;
  published?: boolean | null;
  categories?: unknown;
  image_url?: string | null;
  raw?: unknown;
  active: boolean;
  tn_last_sync_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TaxSettings = {
  key: string;
  iibb_rate: number;
  idc_rate: number;
  iigg_rate: number;
  structure_rate: number;
  notes?: string | null;
  updated_at?: string;
};

export type ProductChannelMargin = {
  id?: string;
  product_id: string;
  sku?: string | null;
  channel_code: string;
  desired_margin_rate: number;
  desired_net_profit?: number | null;
  structure_amount?: number | null;
  manual_shipping_amount?: number | null;
  sales_commission_rate?: number | null;
  sale_applies_vat?: boolean | null;
  cost_vat_rate?: number | null;
  promo_discount_rate?: number | null;
  updated_at?: string;
};
