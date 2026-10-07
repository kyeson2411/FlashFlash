import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function DeckMissing() {
  return (
    <EmptyState
      title="We can't find this deck"
      description="It may have been removed, or it belongs to another account. Open My Decks to continue."
    >
      <div className="flex flex-wrap justify-center gap-3">
        <ButtonLink href="/decks" variant="secondary">
          My Decks
        </ButtonLink>
        <ButtonLink href="/generate">Generate flashcards</ButtonLink>
      </div>
    </EmptyState>
  );
}
