import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRAMER EVAL",
    short_name: "Cramer Eval",
    description: "Evaluación académica",
    start_url: "/sistema",
    display: "standalone",
    background_color: "#f3f6fa",
    theme_color: "#087f70",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
