/**
 * Шторки (форма ввода, мастер плана — ?plan=1) живут в истории. Форма ввода поверх ленты на телефоне живёт в истории: открытие добавляет ?new=1, поэтому «назад» на Android
 * и свайп назад на iOS закрывают форму, а не уходят со страницы. Открыта форма или нет — по адресу (Next.js
 * синхронизирует useSearchParams с history.pushState). Тесты — lib/sheet.test.mjs
 */
export const SHEET_PARAM = "new";

type Win = { location: { href: string }; history: Pick<History, "pushState" | "replaceState" | "back"> };

/** Адрес без origin, с ?new=1 или без него */
export function sheetUrl(href: string, open: boolean, param = SHEET_PARAM): string {
  const u = new URL(href);
  if (open) u.searchParams.set(param, "1");
  else u.searchParams.delete(param);
  return u.pathname + u.search + u.hash;
}
export const isSheetOpen = (href: string, param = SHEET_PARAM) => new URL(href).searchParams.get(param) === "1";

/** Открыть: новая запись в истории. true — запись добавлена этим вызовом (закрывать — через back) */
export function openSheet(w: Win, param = SHEET_PARAM): boolean {
  if (isSheetOpen(w.location.href, param)) return false;
  w.history.pushState(null, "", sheetUrl(w.location.href, true, param));
  return true;
}

/** Закрыть: если запись добавили мы — шаг назад (как жест), иначе (перезагрузка с ?new=1) — заменить адрес */
export function closeSheet(w: Win, pushed: boolean, param = SHEET_PARAM): void {
  if (!isSheetOpen(w.location.href, param)) return;
  if (pushed) w.history.back();
  else w.history.replaceState(null, "", sheetUrl(w.location.href, false, param));
}
