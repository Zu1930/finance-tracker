"use client";

import { useTracker } from "./TrackerProvider";
import { todayStr } from "@/lib/utils";

/** Скачивает объект JSON-файлом */
export function downloadJson(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Экспорт — только то, что видно текущему пользователю: тот же объект, что отдаёт GET /api/data */
export function ExportButton() {
  const { data } = useTracker();
  return (
    <button className="tb" onClick={() => downloadJson({ version: 2, ...data }, `traty-${data.me.id}-${todayStr()}.json`)}>
      Экспорт JSON
    </button>
  );
}
