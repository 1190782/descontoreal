import { activeStores, formatList, organizationJsonLd, SITE } from "@descontoreal/core";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactElement, ReactNode } from "react";
import { JsonLdScript } from "@/components/json-ld-script";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name}: vê se o desconto é real`,
    template: `%s | ${SITE.name}`,
  },
  description:
    `Histórico de preços ${formatList(activeStores().map((store) => `da ${store.name}`))}, atualizado ` +
    "todos os dias, com rótulos que explicam cada desconto com números e datas.",
  applicationName: SITE.name,
  icons: { icon: "/favicon.svg" },
  openGraph: { siteName: SITE.name, locale: "pt_PT", type: "website" },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="pt-PT" className={inter.variable}>
      <body className="flex min-h-screen flex-col font-sans">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded focus:bg-white focus:px-3 focus:py-2"
        >
          Saltar para o conteúdo
        </a>
        <SiteHeader />
        <main id="conteudo" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <SiteFooter />
        <JsonLdScript data={organizationJsonLd()} />
      </body>
    </html>
  );
}
