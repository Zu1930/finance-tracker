import type { SVGProps } from "react";
import { ICONS, type IconName } from "./icons";

export type IconSize = 16 | 20 | 24 | 32;

type Props = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: IconName;
  /** 16 — в тексте и чипах, 20 — кнопки и навигация, 24 — основной, 32 — крупные действия */
  size?: IconSize;
  /** Текст для скринридера. Обязателен, если рядом нет видимой подписи. Берите из словаря переводов. */
  label?: string;
  strokeWidth?: number;
};

/**
 * Иконка дизайн-системы. Цвет — currentColor (берётся из цвета текста).
 * С label — role="img" и aria-label; без — декоративная, aria-hidden.
 * В интерфейсе с dir="rtl" направленные иконки зеркалятся автоматически.
 */
export function Icon({ name, size = 20, label, strokeWidth = 2, className, style, ...rest }: Props) {
  const icon = ICONS[name];
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      focusable="false"
      data-icon={name}
      // Размер в rem: на больших экранах иконка растёт вместе с текстом (html font-size), при 16px — те же 16/20/24/32
      style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, ...style }}
      className={["icon", icon.mirrorInRtl ? "icon-mirror-rtl" : "", className].filter(Boolean).join(" ")}
      {...a11y}
      {...rest}
    >
      {label ? <title>{label}</title> : null}
      {icon.body}
    </svg>
  );
}
