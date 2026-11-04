import type { ReactNode } from "react";
import { Icon, type IconSize } from "./Icon";
import type { IconName } from "./icons";
import type { Space } from "@/lib/space";

/** Иконка и подпись: 8px между ними, иконка по центру строки. Иконка декоративная — подпись видна */
export function IconText({ name, size = 16, className = "", children }: { name: IconName; size?: IconSize; className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Icon name={name} size={size} />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** Иконка бюджета: ◆ семья, ◇ личное, ∑ всё вместе */
export const spaceIcon = (s: Space): IconName => `space-${s}`;

/** Ошибка: предупреждение и текст, цвет text-bad. Пустой текст — ничего (место под строку держит родитель) */
export function Problem({ children, className = "" }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return <IconText name="warning" className={`text-bad ${className}`}>{children}</IconText>;
}
