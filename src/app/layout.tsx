import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import "./globals.css";

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
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
      className={`${sourceSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only rounded-md bg-surface px-4 py-2 font-medium text-primary focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <footer className="border-t border-border bg-surface">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] lg:px-8">
            <div className="space-y-2">
              <p className="text-base font-semibold text-ink">AutoFlash</p>
              <p className="type-helper max-w-sm">
                Flashcards made from your own notes, saved to your account, and ready when you are.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink">Product</p>
              <ul className="space-y-1">
                <li>
                  <Link href="/#how" className="type-helper hover:text-ink">
                    How it works
                  </Link>
                </li>
                <li>
                  <Link href="/#features" className="type-helper hover:text-ink">
                    Features
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="type-helper hover:text-ink">
                    Dashboard
                  </Link>
                </li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink">Account</p>
              <ul className="space-y-1">
                <li>
                  <Link href="/login" className="type-helper hover:text-ink">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href="/register" className="type-helper hover:text-ink">
                    Create account
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border">
            <div className="page-shell py-4">
              <p className="type-helper">
                Account data is processed under the Philippine Data Privacy Act of 2012. Study progress is
                for your own learning. It is not a grade or a teacher record.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
