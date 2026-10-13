import { TrackerProvider } from "@/components/TrackerProvider";
import { Shell } from "@/components/Shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TrackerProvider>
      <Shell>{children}</Shell>
    </TrackerProvider>
  );
}
