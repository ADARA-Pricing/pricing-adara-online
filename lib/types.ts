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

export type MercadoLibreInstallmentFee = {
  id?: string;
  code: string;
  name: string;
  installment_count?: number | null;
  financing_fee_rate: number;
  active: boolean;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type MercadoLibrePriceOption = {
  code: string;
  name: string;
  installment_count?: number | null;
  financing_fee_rate: number;
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

export type TaxSettings = {
  key: string;
  iibb_rate: number;
  idc_rate: number;
  iigg_rate: number;
  structure_rate: number;
  notes?: string | null;
  updated_at?: string;
};
