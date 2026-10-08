import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/layout/PageContainer";
import { FlashcardGenerator } from "@/components/generator/FlashcardGenerator";
import { LoadingState } from "@/components/ui/LoadingState";
import { listDeckSummaries, remainingGenerations } from "@/lib/data/decks";
import { requireStudent } from "@/lib/auth/session";

export const metadata = { title: "Generate flashcards | AutoFlash" };

export default function GeneratePage({ searchParams }: { searchParams: Promise<{ deck?: string; class?: string }> }) {
  return (
    <PageContainer className="space-y-8 px-0">
      <div className="af-view-heading">
        <PageHeader
          title="Turn your notes into flashcards"
          description="Enter a topic, paste your class notes, or provide both."
        />
      </div>
      <Suspense fallback={<LoadingState title="Loading…" />}>
        <GenerateBody searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function GenerateBody({ searchParams }: { searchParams: Promise<{ deck?: string; class?: string }> }) {
  const student = await requireStudent();
  const query = await searchParams;
  const decks = await listDeckSummaries();
  const visible = (
    student.role === "teacher"
      ? decks.filter((deck) => deck.classId && (!query.class || deck.classId === query.class))
      : decks.filter((deck) => !deck.classId)
  ).map((deck) => ({ id: deck.id, title: deck.title }));
  const quota = await remainingGenerations().catch(() => null);
  return (
    <FlashcardGenerator
      decks={visible}
      initialDeckId={query.deck}
      remaining={quota?.remaining ?? null}
      dailyLimit={quota?.limit ?? null}
      forTeacher={student.role === "teacher"}
    />
  );
}
