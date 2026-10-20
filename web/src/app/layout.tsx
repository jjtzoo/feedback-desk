import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

// Self-hosted at build time by next/font; no font requests go to Google at runtime.
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["500"] });

export const metadata: Metadata = {
  title: { default: "Smoke Signal", template: "%s · Smoke Signal" },
  description: "Tell the REDADAIR Digital team what's not working, or what would help, and track it like a parcel.",
  icons: { icon: "/brand/smoke-signal-icon.svg", apple: "/brand/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#14161a" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={`${jakarta.variable} ${jetbrains.variable} antialiased`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <script
          // Follow the device theme before paint, so dark mode doesn't flash.
          dangerouslySetInnerHTML={{
            __html:
              "try{if(window.matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
