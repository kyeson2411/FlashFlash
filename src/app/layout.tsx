import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import { AppFrame } from "@/components/layout/AppFrame";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AutoFlash",
    template: "%s",
  },
  description:
    "Turn class notes into private flashcards, then study them when they are ready.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background font-sans text-ink">
        <a
          href="#main"
          className="sr-only rounded-md bg-surface px-4 py-2 font-medium text-primary focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10"
        >
          Skip to content
        </a>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
