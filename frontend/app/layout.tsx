import type { Metadata, Viewport } from "next";
import { Anek_Devanagari, Anek_Kannada, Anek_Latin, Martian_Mono } from "next/font/google";
import "./globals.css";

// One type family across English, Kannada and Hindi (Anek, by Ek Type), with a width axis: condensed for
// signboard headlines, normal for reading. Martian Mono for codes, prices and the work log.
const anek = Anek_Latin({ subsets: ["latin"], axes: ["wdth"], variable: "--font-anek", display: "swap" });
const kannada = Anek_Kannada({ subsets: ["kannada"], axes: ["wdth"], variable: "--font-kannada", display: "swap" });
const devanagari = Anek_Devanagari({ subsets: ["devanagari"], axes: ["wdth"], variable: "--font-devanagari", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-martian", display: "swap" });

export const metadata: Metadata = {
  title: "Counterpart",
  description: "The marketing employee behind your counter.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#f3f2ed" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anek.variable} ${kannada.variable} ${devanagari.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
