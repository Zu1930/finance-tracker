import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import type { ReactNode } from "react";

// README читается при сборке: страница статическая, текст один — тот же, что в репозитории
export const dynamic = "force-static";

/** Разделы «## Голосовой ввод» и «## Siri» из README: строки и заголовок каждого */
function sections(): string[] {
  const md = readFileSync(join(process.cwd(), "README.md"), "utf8");
  return ["Голосовой ввод", "Siri"].flatMap((title) => {
    const start = md.indexOf(`\n## ${title}\n`);
    const end = md.indexOf("\n## ", start + 1);
    return [`## ${title}`, ...md.slice(start + title.length + 5, end).split("\n")];
  });
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
  let ordered = false;
  const flush = () => {
    if (list.length) out.push(ordered
      ? <ol key={out.length} className="mt-3 list-decimal space-y-2 pl-6">{list}</ol>
      : <ul key={out.length} className="mt-3 list-['—_'] space-y-2 pl-6">{list}</ul>);
    list = [];
  };
  for (const line of sections()) {
    const item = /^(\d+\.|-) (.*)$/.exec(line);
    if (item && (!list.length || ordered === (item[1] !== "-"))) {
      ordered = item[1] !== "-";
      list.push(<li key={list.length}>{inline(item[2])}</li>);
    } else {
      flush();
      if (item) {
        ordered = item[1] !== "-";
        list.push(<li key={list.length}>{inline(item[2])}</li>);
      } else if (line.startsWith("## ")) out.push(<h2 key={out.length} id={line.includes("Siri") ? "siri" : "voice"} className="mt-10 text-base font-bold uppercase">{line.slice(3)}</h2>);
      else if (line.startsWith("### ")) out.push(<h3 key={out.length} className="sec mt-6">{line.slice(4)}</h3>);
      else if (line.trim()) out.push(<p key={out.length} className="mt-3">{inline(line)}</p>);
    }
  }
  flush();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sec">Голосовой ввод и Siri</h1>
        <Link href="/settings" className="tb">← Настройки</Link>
      </div>
      <div className="max-w-[72ch]">{out}</div>
    </>
  );
}
