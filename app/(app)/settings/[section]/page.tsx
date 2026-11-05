import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/codes";
import { isSection } from "@/lib/settings-meta";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SectionContent } from "@/components/settings/SectionContent";
import { HelpAside } from "@/components/help/Help";
import type { ArticleId } from "@/lib/help";

/** Статья помощи к разделу — подсказка справа на 1920+; у разделов без своей статьи колонки нет */
const HELP: Partial<Record<string, ArticleId>> = { family: "family", currency: "currency", input: "voice", device: "install" };

/** /settings/<раздел>; beta — только админам (остальным 404), старый /settings/siri — на /settings/input/siri */
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === "siri") redirect("/settings/input/siri");
  if (!isSection(section)) notFound();
  if (section === "beta") {
    const session = await getAuth().api.getSession({ headers: await headers() });
    if (!session || !isAdmin(session.user.id)) notFound();
  }
  const help = HELP[section];
  const md = help ? await readFile(join(process.cwd(), "content/help", `${help}.md`), "utf8") : null;
  return (
    <div className="l-doc">
      <div className="min-w-0 [grid-area:main]"><SectionContent section={section} /></div>
      {help && md && <HelpAside id={help} md={md} />}
    </div>
  );
}
