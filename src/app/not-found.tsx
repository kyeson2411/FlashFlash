import { PageContainer } from "@/components/layout/PageContainer";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <PageContainer size="narrow">
      <EmptyState title="Page not found" description="That address does not match a page in AutoFlash.">
        <ButtonLink href="/">Back to home</ButtonLink>
      </EmptyState>
    </PageContainer>
  );
}
