import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ADARA Ventas",
    short_name: "ADARA Ventas",
    description: "Monitor de ventas, stock y simulador de ADARA.",
    start_url: "/monitor-ventas",
    display: "standalone",
    background_color: "#f3f6fb",
    theme_color: "#246bfe",
    lang: "es-AR",
    icons: [{ src: "/adara-mark.png", sizes: "1024x1024", type: "image/png", purpose: "any" }],
  };
}
