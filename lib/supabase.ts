import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PRICING_FIXTURES === "1" && typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return require("./pricingFixtures").pricingFixtureClient as ReturnType<typeof createBrowserClient>;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createBrowserClient(url, anonKey);
}
