"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  /** Фильтр ввода, например amountChars для сумм */
  sanitize?: (v: string) => string;
  /** Вызывается на blur и Enter; вернуть false — откатить значение */
  onCommit: (v: string) => boolean | void;
};

/** Поле, которое сохраняет значение по уходу фокуса или Enter, а не на каждую букву */
export function CommitInput({ value, onCommit, sanitize, ...rest }: Props) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v === value) return;
    if (onCommit(v) === false) setV(value);
  };
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(sanitize ? sanitize(e.target.value) : e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(value);
      }}
    />
  );
}
