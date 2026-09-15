import type { MercadoLibreOrderItem } from "./types";
const present = (value: unknown) => value !== null && value !== undefined && Number.isFinite(Number(value));
// Stored historical outputs, never recomputed with today's costs in the UI.
// Each ratio includes the same set of sales in numerator and denominator.
export function profitabilityTotals(sales: MercadoLibreOrderItem[]) {
  const real = sales.filter(sale => !sale.normalized_profit_error && present(sale.real_total_net_profit) && present(sale.real_net_sale_price));
  const normalized = sales.filter(sale => !sale.normalized_profit_error && present(sale.normalized_total_net_profit) && present(sale.normalized_net_sale_price));
  const costSales = normalized.filter(sale => present(sale.normalized_cost_for_profit));
  const sum = (rows: MercadoLibreOrderItem[], value: (row: MercadoLibreOrderItem) => number) => rows.reduce((total, row) => total + value(row), 0);
  const netProfit = sum(real, row => Number(row.real_total_net_profit));
  const netSale = sum(real, row => Number(row.real_net_sale_price) * Number(row.quantity));
  const normalizedProfit = sum(normalized, row => Number(row.normalized_total_net_profit));
  const normalizedNetSale = sum(normalized, row => Number(row.normalized_net_sale_price) * Number(row.quantity));
  const costBasis = sum(costSales, row => Number(row.normalized_cost_for_profit) * Number(row.quantity));
  const costProfit = sum(costSales, row => Number(row.normalized_total_net_profit));
  const coveredRevenue = sum(real, row => Number(row.total_amount));
  return { netProfit: real.length ? netProfit : null, netSale, normalizedProfit: normalized.length ? normalizedProfit : null, normalizedNetSale, costBasis, costProfit, coveredRevenue,
    margin: real.length && netSale > 0 ? netProfit / netSale * 100 : null,
    normalizedMargin: normalized.length && normalizedNetSale > 0 ? normalizedProfit / normalizedNetSale * 100 : null,
    marginOnCost: costSales.length && costBasis > 0 ? costProfit / costBasis * 100 : null,
    errors: sales.length - real.length, calculatedSales: real.length };
}
