/**
 * Форма ввода поверх ленты на телефоне живёт в истории: открытие добавляет ?new=1, поэтому «назад» на Android
 * и свайп назад на iOS закрывают форму, а не уходят со страницы. Открыта форма или нет — по адресу (Next.js
 * синхронизирует useSearchParams с history.pushState). Тесты — lib/sheet.test.mjs
 */
export const SHEET_PARAM = "new";

type Win = { location: { href: string }; history: Pick<History, "pushState" | "replaceState" | "back"> };

/** Адрес без origin, с ?new=1 или без него */
export function sheetUrl(href: string, open: boolean): string {
  const u = new URL(href);
  if (open) u.searchParams.set(SHEET_PARAM, "1");
  else u.searchParams.delete(SHEET_PARAM);
  return u.pathname + u.search + u.hash;
}
export const isSheetOpen = (href: string) => new URL(href).searchParams.get(SHEET_PARAM) === "1";

/** Открыть: новая запись в истории. true — запись добавлена этим вызовом (закрывать — через back) */
export function openSheet(w: Win): boolean {
  if (isSheetOpen(w.location.href)) return false;
  w.history.pushState(null, "", sheetUrl(w.location.href, true));
  return true;
}

/** Закрыть: если запись добавили мы — шаг назад (как жест), иначе (перезагрузка с ?new=1) — заменить адрес */
export function closeSheet(w: Win, pushed: boolean): void {
  if (!isSheetOpen(w.location.href)) return;
  if (pushed) w.history.back();
  else w.history.replaceState(null, "", sheetUrl(w.location.href, false));
}
