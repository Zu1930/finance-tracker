'use client'

import { useState } from 'react'
import { useTracker } from '../TrackerProvider'
import { PayControl } from './PayControl'
import { useRecurring, type Row } from './useRecurring'
import { amountIn, yearlyElsewhere } from '@/lib/recurring'
import type { RecurringPayment } from '@/lib/types'
import { MONTHS_IN, fmt, termName } from '@/lib/utils'

const MARK = { paid: '[✓]', overdue: '[!]', upcoming: '[ ]' } as const
const TONE = { paid: 'text-muted', overdue: 'text-warn', upcoming: 'text-ink' } as const

/** :: РЕГУЛЯРНЫЕ месяца. future — будущий месяц: оплаты нет, статус [ ] */
export function RecurringSection({ month, future }: { month: string; future: boolean }) {
	const { data, scopeTag } = useTracker()
	const st = data.settings!
	const { rows, skipped, catName, pay, skip, pause, all } = useRecurring(month)
	const [menu, setMenu] = useState<string | null>(null)
	if (rows.length === 0 && skipped.length === 0 && all.length === 0) return null

	const paid = rows.filter((r) => r.status === 'paid').length
	const left = rows.filter((r) => r.status !== 'paid').reduce((a, r) => a + (r.estimateBase ?? 0), 0)
	const yearly = yearlyElsewhere(all, month)
	const money = (r: { amount: number; currency: string }) => `${fmt(r.amount)}${r.currency === st.base ? '' : ` ${r.currency}`}`

	const menuFor = (p: RecurringPayment, isSkipped: boolean) =>
		menu === p.id && (
			<div className="col-span-full flex flex-wrap gap-2 pb-1">
				<button className="tb" onClick={() => { setMenu(null); void skip(p, month, !isSkipped) }}>{isSkipped ? 'Вернуть' : 'Пропустить месяц'}</button>
				{!isSkipped && <button className="tb" onClick={() => { setMenu(null); void pause(p, true) }}>Пауза</button>}
			</div>
		)
	const menuBtn = (p: RecurringPayment) => (
		<button className="tb tb-tight" aria-label={`Действия: ${p.name}`} aria-expanded={menu === p.id} onClick={() => setMenu(menu === p.id ? null : p.id)}>…</button>
	)

	const row = (r: Row) => {
		const status = future ? 'upcoming' : r.status
		const p = r.payment
		const isPaid = r.status === 'paid'
		const shown = isPaid ? `${fmt(r.paidBase ?? r.amount)}` : `${r.approx ? '≈ ' : ''}${money(r)}`
		const inBase = !isPaid && r.currency !== st.base && r.estimateBase !== null ? ` ≈ ${fmt(Math.round(r.estimateBase))}` : ''
		return (
			<li key={r.paymentId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-dashed border-line2 py-1 uppercase sm:grid-cols-[3ch_3ch_minmax(0,1fr)_7ch_auto_auto_auto]">
				<span className={`${TONE[status]} max-sm:hidden`} aria-label={{ paid: 'оплачено', overdue: 'просрочено', upcoming: 'не оплачено' }[status]}>{MARK[status]}</span>
				<span className="text-muted max-sm:hidden">{r.dueDate.slice(8)}</span>
				<span className="min-w-0 truncate">
					<span className={`sm:hidden ${TONE[status]}`}>{MARK[status]} </span>
					<span className={isPaid ? 'text-muted' : ''}>{termName(r.name)}</span>
					<span className="text-muted max-sm:hidden"> // {catName(p)}</span>
				</span>
				<span className="text-muted max-sm:hidden">{scopeTag(p.scope) && `[${scopeTag(p.scope)}]`}</span>
				<span className="text-right">
					<b className={isPaid ? 'font-normal text-muted' : ''}>{shown}</b>
					{inBase && <span className="text-muted">{inBase}</span>}
				</span>
				<span className="truncate text-xs text-muted sm:hidden">{r.dueDate.slice(8)} · {catName(p)}{scopeTag(p.scope) && ` · ${scopeTag(p.scope)}`}</span>
				<span className="flex items-center justify-end gap-2 has-[input]:col-span-full sm:contents">
					<span className="has-[input]:flex-1 sm:text-right">
						{isPaid ? <span className="text-muted2">Записано</span> : future ? null : <PayControl row={r} pay={(a) => pay(p, month, a)} />}
					</span>
					{!isPaid && menuBtn(p)}
				</span>
				{menuFor(p, false)}
			</li>
		)
	}

	return (
		<section className="mt-6 border-t border-dashed border-line pt-5">
			<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
				<h2 className="sec">↻ Регулярные // оплачено {paid} из {rows.length}</h2>
				{!future && left > 0 && <span className="text-muted uppercase">Осталось оплатить <b className="text-ink">{fmt(Math.round(left))}</b></span>}
			</div>
			<ul className="mt-2">
				{rows.map(row)}
				{skipped.map((p) => (
					<li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-dashed border-line2 py-1 text-muted uppercase sm:grid-cols-[3ch_3ch_minmax(0,1fr)_auto_auto]">
						<span className="max-sm:hidden">[—]</span>
						<span className="max-sm:hidden">{String(p.day).padStart(2, '0')}</span>
						<span className="min-w-0 truncate line-through"><span className="sm:hidden">[—] </span>{termName(p.name)}</span>
						<span className="line-through">{money({ amount: amountIn(p, month), currency: p.currency })}</span>
						<span className="col-span-full flex justify-end sm:col-span-1">{menuBtn(p)}</span>
						{menuFor(p, true)}
					</li>
				))}
			</ul>
			{yearly.length > 0 && (
				<p className="mt-2 text-muted2 uppercase">
					Ежегодные: {yearly.map((p) => `${termName(p.name)} ${money({ amount: amountIn(p, month), currency: p.currency })} — в ${MONTHS_IN[(p.month ?? 1) - 1]}`).join(' · ')}
				</p>
			)}
		</section>
	)
}
