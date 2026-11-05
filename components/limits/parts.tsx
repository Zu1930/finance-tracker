'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { equationTotal, type Equation } from '@/lib/plan-view'
import { t } from '@/lib/i18n'
import { fmt, signed } from '@/lib/utils'

/** Кнопки страницы: обычная в рамке и главная (инверсия, 52px) */
export const BTN = 'tbox min-h-11 justify-center gap-2 px-3'
export const PRIMARY = 'tbox h-[3.25rem] w-full justify-center gap-2 border-ink bg-ink text-[0.9375rem] font-bold text-panel hover:bg-ink'

/**
 * Пример в столбик: знак | подпись | сумма. Последняя строка — «= Отложится» (с минусом — красным);
 * у личного бюджета дохода нет — первой строки нет, внизу «= Всего за месяц»
 */
export function PlanEquation({ e }: { e: Equation }) {
	const rows: [string, ReactNode, string][] = [
		...(e.income !== null ? [['+', t('plan.income'), fmt(e.income)] as [string, ReactNode, string]] : []),
		['−', t('plan.required'), fmt(e.required)],
		['−', <>{t('plan.living')} <span className="text-muted">{t('plan.livingNote')}</span></>, fmt(e.living)],
		['−', t('plan.purchases'), fmt(e.purchases)],
	]
	const bad = e.rest !== null && e.rest < 0
	const last = 'border-t border-ink pt-1'
	return (
		<div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-1.5">
			{rows.map(([sign, label, value], i) => (
				<div key={i} className="contents">
					<span aria-hidden="true">{sign}</span>
					<span>{label}</span>
					<b className="text-right">{value}</b>
				</div>
			))}
			<span aria-hidden="true" className={last}>=</span>
			<span className={last}>{e.rest === null ? t('plan.total') : t('plan.rest')}</span>
			<b className={`${last} text-right ${bad ? 'text-bad' : ''}`}>{e.rest === null ? fmt(equationTotal(e)) : signed(e.rest)}</b>
		</div>
	)
}

/** Крупно: «+163 400 ОТЛОЖИТСЯ», «−12 000 НЕ ХВАТАЕТ» или, без дохода, «95 000 ВСЕГО ЗА МЕСЯЦ» */
export function PlanTotal({ e }: { e: Equation }) {
	const bad = e.rest !== null && e.rest < 0
	return (
		<div className="flex items-baseline gap-2">
			<span className={`text-[2rem] leading-tight font-bold tracking-tight ${bad ? 'text-bad' : ''}`}>{e.rest === null ? fmt(equationTotal(e)) : signed(e.rest)}</span>
			<span className={`text-xs uppercase ${bad ? 'text-bad' : 'text-muted'}`}>{e.rest === null ? t('plan.total') : bad ? t('plan.short') : t('plan.rest')}</span>
		</div>
	)
}

/** Шторка снизу поверх страницы: фон закрывает, Esc закрывает, фокус — внутрь. full — во весь экран, кроме 40px сверху */
export function Sheet({ label, onClose, full = false, children }: { label: string; onClose: () => void; full?: boolean; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null)
	const close = useRef(onClose)
	close.current = onClose
	useEffect(() => {
		ref.current?.focus()
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])
	return (
		<>
			<div aria-hidden="true" className="fixed inset-0 z-40 motion-safe:animate-[fade-in_.25s_ease-out]" style={{ background: 'rgba(0,0,0,.35)' }} onClick={onClose} />
			<div
				ref={ref}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label={label}
				// Телефон — шторка снизу; десктоп — панель справа поверх страницы, 480px (на 1920+ — 560px), страница под ней видна
				className={`fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-ink bg-panel px-4 pt-3.5 pb-[calc(1.125rem+env(safe-area-inset-bottom,0rem))] outline-none motion-safe:animate-[sheet-up_.32s_cubic-bezier(.2,.8,.2,1)] ${full ? 'top-10' : 'max-h-[80dvh]'} sm:top-0 sm:left-auto sm:max-h-none sm:w-[480px] sm:max-w-full sm:border-t-0 sm:border-l sm:px-6 sm:pt-5 sm:pb-6 sm:motion-safe:animate-[side-in_.28s_cubic-bezier(.2,.8,.2,1)] huge:w-[560px]`}
			>
				{children}
			</div>
		</>
	)
}
