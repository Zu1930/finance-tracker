'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'

const ddmm = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

/**
 * Секрет, который показывается один раз: ссылка-приглашение, токен Siri, код беты.
 * Рамка warn, срок, значение с многоточием (полностью — в title), копировать (2 с «скопировано»), скрыть
 */
export function OnceReveal({ value, until, note, onHide }: { value: string; until?: string; note?: ReactNode; onHide: () => void }) {
	const [copied, setCopied] = useState(false)
	const [failed, setFailed] = useState(false)
	useEffect(() => {
		if (!copied) return
		const t = setTimeout(() => setCopied(false), 2000)
		return () => clearTimeout(t)
	}, [copied])
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
			setFailed(false)
		} catch {
			setFailed(true)
		}
	}
	return (
		<div className="mt-3 border border-warn p-3">
			<p className="text-xs text-warn uppercase">Показывается один раз{until && ` · действует до ${ddmm(until)}`}</p>
			<code title={value} className="mt-2 block truncate normal-case select-all">{value}</code>
			{note && <p className="mt-1 text-xs text-muted2">{note}</p>}
			<div className="mt-2 flex flex-wrap gap-2 uppercase">
				<button className="tb" onClick={() => void copy()} aria-live="polite">{copied ? 'Скопировано' : 'Копировать'}</button>
				<button className="tb" onClick={onHide}>Скрыть</button>
			</div>
			{failed && <p className="mt-2 text-xs text-muted2 uppercase">// Не удалось скопировать — выделите вручную</p>}
		</div>
	)
}

/** Опасное действие: dashed-рамка bad; подпись кнопки с многоточием — дальше всегда подтверждение */
export function DangerZone({ title, children, action, href }: { title: string; children: ReactNode; action: string; href: string }) {
	return (
		<section className="mt-7 border border-dashed border-bad p-4">
			<h2 className="text-[13px] font-bold text-bad uppercase">:: {title}</h2>
			<p className="mt-2 text-muted2">{children}</p>
			<Link href={href} className="tb mt-3 border border-bad text-bad uppercase max-sm:h-11 max-sm:w-full">{action}</Link>
		</section>
	)
}

/** Строка настроек: min 44px, dashed-разделитель, слева содержимое, справа действие или мета */
export function SettingsRow({ children, end, className = '' }: { children: ReactNode; end?: ReactNode; className?: string }) {
	return (
		<div className={`flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-b border-dashed border-line2 py-1.5 ${className}`}>
			<div className="min-w-0 flex-1">{children}</div>
			{end !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{end}</div>}
		</div>
	)
}
