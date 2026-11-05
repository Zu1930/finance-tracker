/** Шкалы из символов (█░): сколько символов влезает в контейнер. Чистая функция — проверяется тестом (lib/ascii.test.mjs) */

/** До замера и на сервере */
export const BAR_DEFAULT = 24;
/** Длиннее не нужно: шкала не тянется на всю широкую колонку */
export const BAR_MAX = 60;

/**
 * Число символов шкалы: столько, сколько целиком помещается в ширину контейнера, но не больше max.
 * charW — ширина одного «█» в текущем шрифте (символ может рисоваться запасным шрифтом и быть шире буквы)
 */
export function barCells(containerW: number, charW: number, max = BAR_MAX): number {
  if (!(charW > 0) || !(containerW > 0)) return containerW > 0 ? BAR_DEFAULT : 0;
  return Math.max(0, Math.min(max, Math.floor(containerW / charW)));
}
