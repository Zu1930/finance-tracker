'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { equationTotal, type Equation } from '@/lib/plan-view'
import { t } from '@/lib/i18n'
import { fmt, signed } from '@/lib/utils'
import { Portal, useInertApp, useScrollLock } from '../useSheet'

/** Кнопки страницы: обычная в рамке и главная (инверсия, 52px) */
export const BTN = 'tbox min-h-11 justify-center gap-2 px-3'
export const PRIMARY = 'tbox h-[3.25rem] w-full justify-center gap-2 border-ink bg-ink text-[0.9375rem] font-bold text-panel hover:bg-ink'

/**
 * Пример в столбик: знак | подпись | сумма. Последняя строка — «= Отложится» (с минусом — красным);
 * у личного бюджета дохода нет — первой строки нет, внизу «= Всего за месяц»
 */
export type EquationNotes = Partial<Record<'income' | 'required' | 'living' | 'purchases' | 'rest', ReactNode>>

/**
 * + Придёт / − Обязательные / − На текущие траты (лимиты) / − Покупки / = Отложится. Общее для телефона, мастера и десктопа.
 * notes — пояснение второй строкой под суммой; income — поле ввода вместо числа дохода.
 * adaptive — по ширине своего блока: уже 420px подпись стоит над суммой, а не слева от неё
 */
export function PlanEquation({ e, notes = {}, income, adaptive = false }: { e: Equation; notes?: EquationNotes; income?: ReactNode; adaptive?: boolean }) {
	const rows: [keyof EquationNotes, string, ReactNode, ReactNode][] = [
		...(e.income !== null ? [['income', '+', t('plan.income'), income ?? fmt(e.income)] as [keyof EquationNotes, string, ReactNode, ReactNode]] : []),
		['required', '−', t('plan.required'), fmt(e.required)],
		['living', '−', <>{t('plan.living')} <span className="text-muted">{t('plan.livingNote')}</span></>, fmt(e.living)],
		['purchases', '−', t('plan.purchases'), fmt(e.purchases)],
	]
	const bad = e.rest !== null && e.rest < 0
	const last = 'border-t border-ink pt-1'
	// Сумма с пояснением: в узком блоке — под подписью, иначе — справа
	const val = adaptive ? 'col-start-2 min-w-0 @min-[420px]:col-start-auto @min-[420px]:text-right' : 'min-w-0 text-right'
	const note = (k: keyof EquationNotes) => notes[k] && <span className="block text-xs font-normal text-muted normal-case">{notes[k]}</span>
	const grid = (
		<div className={`grid items-baseline gap-x-2.5 gap-y-1.5 ${adaptive ? 'grid-cols-[1.25rem_minmax(0,1fr)] @min-[420px]:grid-cols-[1.25rem_minmax(0,1fr)_auto]' : 'grid-cols-[1.25rem_minmax(0,1fr)_auto]'}`}>
			{rows.map(([k, sign, label, value]) => (
				<div key={k} className="contents">
					<span aria-hidden="true">{sign}</span>
					<span className="min-w-0">{label}</span>
					<span className={val}><b>{value}</b>{note(k)}</span>
				</div>
			))}
			<span aria-hidden="true" className={last}>=</span>
			<span className={`${last} min-w-0`}>{e.rest === null ? t('plan.total') : t('plan.rest')}</span>
			<span className={`${val} ${adaptive ? '@min-[420px]:border-t @min-[420px]:border-ink @min-[420px]:pt-1' : last}`}>
				<b className={bad ? 'text-bad' : ''}>{e.rest === null ? fmt(equationTotal(e)) : signed(e.rest)}</b>{note('rest')}
			</span>
		</div>
	)
	return adaptive ? <div className="@container">{grid}</div> : grid
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
	useScrollLock(true)
	useInertApp(true)
	useEffect(() => {
		ref.current?.focus()
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])
	return (
		<Portal>
			<div aria-hidden="true" className="fixed inset-0 z-40 [touch-action:none] motion-safe:animate-[fade-in_.25s_ease-out]" style={{ background: 'rgba(0,0,0,.35)' }} onClick={onClose} />
			<div
				ref={ref}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label={label}
				// Телефон — шторка снизу; десктоп — панель справа поверх страницы, 480px (на 1920+ — 560px), страница под ней видна
				className={`fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-ink bg-panel px-4 pt-3.5 pb-[calc(1.125rem+env(safe-area-inset-bottom,0rem))] overscroll-contain outline-none motion-safe:animate-[sheet-up_.32s_cubic-bezier(.2,.8,.2,1)] ${full ? 'top-10' : 'max-h-[80dvh]'} sm:top-0 sm:left-auto sm:max-h-none sm:w-[480px] sm:max-w-full sm:border-t-0 sm:border-l sm:px-6 sm:pt-5 sm:pb-6 sm:motion-safe:animate-[side-in_.28s_cubic-bezier(.2,.8,.2,1)] huge:w-[560px]`}
			>
				{children}
			</div>
		</Portal>
	)
}
