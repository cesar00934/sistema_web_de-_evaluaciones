import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "CRAMER EVAL · Evaluación académica",
  description: "Exámenes, corrección y seguimiento académico",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cramer Eval" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
