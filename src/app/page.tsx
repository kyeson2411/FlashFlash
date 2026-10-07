import type { Metadata } from "next";
import { Suspense } from "react";
import { LandingPage } from "@/components/marketing/LandingPage";
import { getStudent } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "AutoFlash — Flashcards from your own notes",
  description:
    "Paste a topic or your class notes. AutoFlash writes the cards, saves them in private decks, and brings them back when they are ready to study.",
};

export default function HomePage() {
  return (
    <Suspense fallback={<LandingPage pending />}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const student = await getStudent();
  return <LandingPage signedIn={student !== null} />;
}
