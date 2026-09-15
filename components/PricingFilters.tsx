"use client";
import { categoryOptions } from "@/lib/pricingData";
export function CategoryFilter({ value, onChange, categories }: { value: string; onChange: (value: string) => void; categories: string[] }) {
  return <label className="pricing-filter"><span>Categoría</span><select value={value} onChange={event => onChange(event.target.value)}><option value="">Todas las categorías</option>{categoryOptions(categories).map(label => <option key={label} value={label}>{label}</option>)}</select></label>;
}
export function PricingSearch({ value, onChange, placeholder = "Buscar SKU, producto o MLA" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="pricing-filter pricing-search"><span>Buscar</span><input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
