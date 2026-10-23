import { HelpFrame } from "@/components/help/Help";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <HelpFrame>{children}</HelpFrame>;
}
