"use client";

import { useRef } from "react";
import { useTracker } from "./TrackerProvider";

export function ImportButton() {
  const { reload, toast, data } = useTracker();
  const input = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast("Файл не похож на экспорт трекера: это не JSON.");
      return;
    }
    if (data.settings && !window.confirm("Импорт заменит текущие настройки, копилки и месяцы из файла. Продолжить?")) return;
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; months?: number };
    if (!res.ok) {
      toast(json.error ?? "Импорт не удался.");
      return;
    }
    await reload();
    toast(`Импортировано месяцев: ${json.months ?? 0}`);
  };

  return (
    <>
      <button className="tb" onClick={() => input.current?.click()}>Импорт JSON</button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
    </>
  );
}

export function ExportButton() {
  const { data } = useTracker();
  const run = () => {
    const blob = new Blob([JSON.stringify({ version: 1, ...data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `traty-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return <button className="tb" onClick={run}>Экспорт JSON</button>;
}
