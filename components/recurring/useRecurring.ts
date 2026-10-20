'use client'

import { useTracker } from '../TrackerProvider'
import { monthOccurrences } from '@/lib/metrics'
import { amountIn, scheduledIn, type Occurrence } from '@/lib/recurring'
import type { Expense, RecurringPayment } from '@/lib/types'
import { fmt, termName, todayStr, uid } from '@/lib/utils'

export type Row = Occurrence & { month: string; payment: RecurringPayment }

/** Регулярные месяца: вхождения со своими платежами, пропущенные отдельно; оплата, пропуск, пауза */
export function useRecurring(month: string) {
	const { data, addEntry, removeEntry, api, toast } = useTracker()
	const st = data.settings!
	const all = [...data.recurring.family, ...data.recurring.mine]
	const byId = new Map(all.map((p) => [p.id, p]))
	const today = todayStr()
	const occ = monthOccurrences(data, month, today)
	const rows: Row[] = [...occ.family, ...occ.mine]
		.map((o) => ({ ...o, month, payment: byId.get(o.paymentId)! }))
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, 'ru'))
	// Пропущенные — по расписанию, но месяц в skips: показываются зачёркнутыми
	const skipped = all.filter((p) => !p.paused && scheduledIn(p, month) && p.skips.includes(month))

	const catName = (p: RecurringPayment) => {
		const cats = p.scope === 'personal' ? data.mySettings.personalCategories : st.familyCategories
		const c = cats.find((x) => x.id === p.categoryId)
		return c ? termName(c.name) : 'категория удалена'
	}

	/** Оплата — обычная трата с recurringId: сразу на экране и работает без связи (офлайн-очередь) */
	const pay = (p: RecurringPayment, payMonth: string, amount?: number) => {
		const a = amount ?? amountIn(p, payMonth)
		const rate = p.currency === st.base ? 1 : st.rates[p.currency]
		if (!rate) return toast(`Нет курса ${p.currency} — обновите курсы в настройках.`)
		const e: Expense = {
			id: uid(), amount: a, currency: p.currency, rate, base: Math.round(a * rate * 100) / 100,
			catId: p.categoryId, note: p.name, date: today, ts: Date.now(), scope: p.scope, authorId: data.me.id,
			recurringId: p.id, recurringMonth: payMonth,
		}
		addEntry('expense', e)
		toast(`Записано: −${fmt(e.amount)} ${e.currency} → ${catName(p)} // ↻ ${termName(p.name)}`, 'Отменить', () => removeEntry('expense', e))
	}
	const skip = (p: RecurringPayment, m: string, on: boolean) => api(`/api/recurring/${p.id}/${on ? 'skip' : 'unskip'}`, 'POST', { scope: p.scope, month: m })
	const pause = (p: RecurringPayment, paused: boolean) => api(`/api/recurring/${p.id}`, 'PATCH', { scope: p.scope, version: p.version, paused })

	return { rows, skipped, catName, pay, skip, pause, all }
}
