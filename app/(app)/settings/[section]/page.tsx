import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/codes";
import { isSection } from "@/lib/settings-meta";
import { SectionContent } from "@/components/settings/SectionContent";

/** /settings/<раздел>; beta — только админам (остальным 404), старый /settings/siri — на /settings/input/siri */
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === "siri") redirect("/settings/input/siri");
  if (!isSection(section)) notFound();
  if (section === "beta") {
    const session = await getAuth().api.getSession({ headers: await headers() });
    if (!session || !isAdmin(session.user.id)) notFound();
  }
  return <SectionContent section={section} />;
}
