import { Review } from "@/components/family/Review";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Review householdId={(await params).id} />;
}
