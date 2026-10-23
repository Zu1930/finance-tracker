import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Article } from "@/components/help/Help";
import { ARTICLES, type ArticleId } from "@/lib/help";

// Тексты собираются при сборке; неизвестная статья — 404
export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = () => ARTICLES.map((a) => ({ article: a.id }));

export default async function Page({ params }: { params: Promise<{ article: ArticleId }> }) {
  const { article } = await params;
  const md = await readFile(join(process.cwd(), "content/help", `${article}.md`), "utf8");
  return <Article id={article} md={md} />;
}
