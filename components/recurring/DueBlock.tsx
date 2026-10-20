'use client'

import { useTracker } from '../TrackerProvider'
import { PayControl } from './PayControl'
import { useRecurring, type Row } from './useRecurring'
import { dueNow } from '@/lib/recurring'
import type { TrackerData } from '@/lib/types'
import { ddmm, fmt, termName, todayStr } from '@/lib/utils'

/** К оплате сейчас: просроченные, сегодняшние и (в первые 7 дней) неоплаченные прошлого месяца */
export function dueRows(data: TrackerData, today: string): Row[] {
	const base = data.settings?.base ?? '', rates = data.settings?.rates ?? {}
	const all = new Map([...data.recurring.family, ...data.recurring.mine].map((p) => [p.id, p]))
	return [
		...dueNow(data.recurring.family, Object.values(data.familyExpenses).flat(), today, base, rates),
		...dueNow(data.recurring.mine, Object.values(data.myExpenses).flat(), today, base, rates),
	]
		.map((o) => ({ ...o, payment: all.get(o.paymentId)! }))
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

/** :: ↻ К ОПЛАТЕ над формой ввода; исчезает, когда всё оплачено */
export function DueBlock() {
	const { data } = useTracker()
	const { pay } = useRecurring(todayStr().slice(0, 7))
	const rows = dueRows(data, todayStr())
	if (rows.length === 0) return null
	const base = data.settings!.base

	return (
		<section id="due" className="mb-6 scroll-mt-4 border border-ink px-3 py-2 uppercase">
			<div className="flex items-baseline justify-between">
				<h2 className="sec">↻ К оплате</h2>
				<b>{rows.length}</b>
			</div>
			<ul className="mt-1">
				{rows.map((r) => {
					const overdue = r.status === 'overdue'
					return (
						<li key={`${r.month}-${r.paymentId}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-dashed border-line2 py-2 first:border-t-0">
							<span className="min-w-0">
								<b className="block truncate">{termName(r.name)}</b>
								<span className={`text-xs ${overdue ? 'text-warn' : 'text-muted'}`}>
									{r.approx && '≈ '}{fmt(r.amount)}{r.currency !== base && ` ${r.currency}`} · {overdue ? `с ${ddmm(r.dueDate)}` : ddmm(r.dueDate)}
								</span>
							</span>
							<PayControl row={r} pay={(a) => pay(r.payment, r.month, a)} big />
						</li>
					)
				})}
			</ul>
		</section>
	)
}
