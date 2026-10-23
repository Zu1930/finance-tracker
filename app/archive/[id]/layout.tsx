import { TrackerProvider } from "@/components/TrackerProvider";
import { Shell } from "@/components/Shell";

/** Архив бывшей семьи: те же экраны, данные из /api/archive/<id>, только чтение */
export default async function ArchiveLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <TrackerProvider source={`/api/archive/${encodeURIComponent(id)}`}>
      <Shell>{children}</Shell>
    </TrackerProvider>
  );
}
