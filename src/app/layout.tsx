import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppFrame } from "@/components/layout/AppFrame";
import { RegisterServiceWorker } from "@/components/pwa/RegisterServiceWorker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "AutoFlash",
    template: "%s",
  },
  description:
    "Turn class notes into private flashcards, then study them when they are ready.",
  applicationName: "AutoFlash",
  appleWebApp: {
    capable: true,
    title: "AutoFlash",
    statusBarStyle: "black",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="flex min-h-full flex-col bg-background font-sans text-ink">
        <a
          href="#main"
          className="sr-only rounded-md bg-surface px-4 py-2 font-medium text-primary focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10"
        >
          Skip to content
        </a>
        <RegisterServiceWorker />
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
