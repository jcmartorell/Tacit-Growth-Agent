import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fuentes incluidas en el proyecto (licencia OFL), para no depender de Google Fonts al compilar
const dmSans = localFont({
  src: "./fonts/dm-sans-latin-wght-normal.woff2",
  variable: "--font-body",
  weight: "100 1000",
  display: "swap",
});
const instrumentSerif = localFont({
  src: "./fonts/instrument-serif-latin-400-normal.woff2",
  variable: "--font-heading",
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tacit Growth",
  description: "Panel interno del motor de growth de Tacit",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${dmSans.variable} ${instrumentSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
