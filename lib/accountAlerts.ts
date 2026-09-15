export function groupAlerts<T extends { sku: string; itemId?: string | null }>(actions: T[]) {
  const groups = new Map<string, T[]>();
  for (const action of actions) {
    const key = action.sku.trim().toUpperCase();
    groups.set(key, [...(groups.get(key) || []), action]);
  }
  return [...groups.entries()].map(([sku, alerts]) => ({ sku, alerts, publications: new Set(alerts.map(alert => alert.itemId).filter(Boolean)).size }));
}
export function resolutionHref(action: { href: string; sku: string; itemId?: string | null }) {
  const url = new URL(action.href, 'https://pricing.local');
  url.searchParams.set('sku', action.sku);
  if (action.itemId) url.searchParams.set('mla', action.itemId);
  return `${url.pathname}${url.search}`;
}
