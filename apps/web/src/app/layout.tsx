import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans-ui" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-ui" });

export const metadata: Metadata = {
  title: "Good Screen — Rekam & Edit Layar",
  description: "Rekam layar dan kamera, lalu edit hasilnya: potong, zoom, latar, dan teks.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
