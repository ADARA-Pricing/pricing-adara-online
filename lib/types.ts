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

export type ChannelType = "mercadolibre" | "directo" | "web" | "posnet" | "otro";

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
  updated_at?: string;
};
