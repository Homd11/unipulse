import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UniPulse — Batch Task Ledger & 2h Reminders",
    short_name: "UniPulse",
    description:
      "Never miss an assignment or quiz buried in group chats. Claim 'On Me' tasks with relentless 2-hour push reminders + your own private task space.",
    start_url: "/?source=pwa",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F6F5F0",
    theme_color: "#0D9488",
    icons: [
      {
        src: "/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
