import { Suspense } from "react";
import { EntryPage } from "@/components/entry/EntryPage";

// useSearchParams в EntryPage требует границу Suspense
export default function Page() {
  return (
    <Suspense>
      <EntryPage />
    </Suspense>
  );
}
