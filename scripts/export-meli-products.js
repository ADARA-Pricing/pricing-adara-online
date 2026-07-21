const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function csv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function attributeText(attributes, ids) {
  const idSet = new Set(ids.map((id) => id.toUpperCase()));
  return (Array.isArray(attributes) ? attributes : []).find((attribute) =>
    idSet.has(String(attribute?.id || "").toUpperCase()),
  )?.value_name || "";
}

function readConnectedAccount() {
  const raw = execFileSync(
    process.env.ComSpec || "cmd.exe",
    [
      "/c",
      "npx.cmd",
      "supabase",
      "db",
      "query",
      "--linked",
      "-o",
      "json",
      "select meli_user_id, access_token, expires_at from public.mercadolibre_accounts order by updated_at desc limit 1;",
    ],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(raw);
  return parsed.rows?.[0] || null;
}

async function meliFetch(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${response.status}: ${data?.message || data?.error || "Error MercadoLibre"}`);
  }
  return data;
}

async function getItemIds(account) {
  const itemIds = new Set();
  const totals = {};

  for (const status of ["active", "paused"]) {
    let offset = 0;
    let total = 0;

    do {
      const url = `https://api.mercadolibre.com/users/${account.meli_user_id}/items/search?status=${status}&limit=50&offset=${offset}`;
      const data = await meliFetch(url, account.access_token);
      const results = Array.isArray(data?.results) ? data.results : [];
      total = Number(data?.paging?.total || results.length || 0);
      totals[status] = total;
      results.forEach((id) => itemIds.add(id));
      offset += 50;
    } while (offset < total && offset < 1000);
  }

  return { itemIds: [...itemIds], totals };
}

async function getItems(itemIds, accessToken) {
  const items = [];

  for (let index = 0; index < itemIds.length; index += 20) {
    const batch = itemIds.slice(index, index + 20);
    const data = await meliFetch(`https://api.mercadolibre.com/items?ids=${batch.join(",")}`, accessToken);
    (Array.isArray(data) ? data : []).forEach((entry) => {
      if (entry?.body?.id) items.push(entry.body);
    });
  }

  return items;
}

async function main() {
  const account = readConnectedAccount();
  if (!account) throw new Error("No hay cuenta MercadoLibre conectada.");

  const { itemIds, totals } = await getItemIds(account);
  const items = await getItems(itemIds, account.access_token);

  const rows = items.map((item) => {
    const sku =
      normalizeSku(item.seller_custom_field) ||
      normalizeSku(attributeText(item.attributes, ["SELLER_SKU"])) ||
      normalizeSku(item.id);

    return [
      item.id,
      sku,
      item.title || "",
      item.status || "",
      item.available_quantity ?? "",
      item.price ?? "",
      item.currency_id || "",
      item.category_id || "",
      attributeText(item.attributes, ["BRAND"]),
      attributeText(item.attributes, ["MODEL"]),
      item.permalink || "",
      item.thumbnail || "",
    ];
  });

  const headers = [
    "meli_item_id",
    "sku",
    "title",
    "status",
    "stock",
    "price",
    "currency",
    "category_id",
    "brand",
    "model",
    "permalink",
    "thumbnail",
  ];

  const exportDir = path.join(process.cwd(), "exports");
  fs.mkdirSync(exportDir, { recursive: true });
  const filePath = path.join(exportDir, `mercadolibre-products-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(filePath, [headers, ...rows].map((row) => row.map(csv).join(",")).join("\n"), "utf8");

  console.log(JSON.stringify({ file: filePath, total_items: items.length, totals }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
