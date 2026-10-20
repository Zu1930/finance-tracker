import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import type { ReactNode } from "react";

// README читается при сборке: страница статическая, текст один — тот же, что в репозитории
export const dynamic = "force-static";

/** Раздел «## Siri» из README */
function siriSection(): string[] {
  const md = readFileSync(join(process.cwd(), "README.md"), "utf8");
  const start = md.indexOf("\n## Siri\n");
  const end = md.indexOf("\n## ", start + 1);
  return md.slice(start + "\n## Siri\n".length, end).split("\n");
}

/** `код` и **жирный** — всё, что есть в разделе */
const inline = (s: string): ReactNode[] =>
  s.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("`") ? <code key={i} className="text-ink normal-case">{part.slice(1, -1)}</code>
    : part.startsWith("**") ? <b key={i}>{part.slice(2, -2)}</b>
    : part,
  );

export default function Page() {
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) out.push(<ol key={out.length} className="mt-3 list-decimal space-y-2 pl-6">{list}</ol>);
    list = [];
  };
  for (const line of siriSection()) {
    const item = /^\d+\. (.*)$/.exec(line);
    if (item) list.push(<li key={list.length}>{inline(item[1])}</li>);
    else {
      flush();
      if (line.startsWith("### ")) out.push(<h2 key={out.length} className="sec mt-8">{line.slice(4)}</h2>);
      else if (line.trim()) out.push(<p key={out.length} className="mt-3">{inline(line)}</p>);
    }
  }
  flush();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sec">Siri / Быстрые команды</h1>
        <Link href="/settings" className="tb">← Настройки</Link>
      </div>
      <div className="max-w-[72ch]">{out}</div>
    </>
  );
}
