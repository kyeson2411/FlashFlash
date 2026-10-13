import { PageContainer } from "@/components/layout/PageContainer";
import { OfflineStudy } from "@/components/study/OfflineStudy";

export const metadata = { title: "Saved decks | AutoFlash" };

export default function StudyOfflinePage() {
  return (
    <PageContainer compact>
      <OfflineStudy />
    </PageContainer>
  );
}
