"use client";

import { Button } from "@/components/ui/Button";
import { PageContainer } from "@/components/layout/PageContainer";
import { Alert } from "@/components/ui/Alert";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <PageContainer size="narrow">
      <Alert
        title="Something went wrong"
        action={
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        }
      >
        Please try again. If this keeps happening, sign out and sign back in.
      </Alert>
    </PageContainer>
  );
}
