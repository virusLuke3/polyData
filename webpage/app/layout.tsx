import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { Navbar } from "@/components/layout/navbar";
import { Sidebar } from "@/components/layout/sidebar";
import { RuntimeErrorListener } from "@/components/system/runtime-error-listener";

import "./globals.css";

const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "polyData Dashboard",
  description: "Polymarket market, trade and oracle intelligence dashboard"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${sans.variable} ${mono.variable} bg-background font-sans text-foreground`}>
        <RuntimeErrorListener />
        <Suspense fallback={null}>
          <Navbar />
        </Suspense>
        <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-6 lg:px-6">
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}