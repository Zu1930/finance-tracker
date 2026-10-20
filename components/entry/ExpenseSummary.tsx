'use client'

import { useTracker } from '../TrackerProvider'
import { AsciiBar } from '../AsciiBar'
import { Contribution } from './Contribution'
import { byAuthor } from '@/lib/metrics'
import { monthLimit, planSpentByCat } from '@/lib/plan'
import type { Category, Scope } from '@/lib/types'
import { curMonthKey, fmt, termName } from '@/lib/utils'

/** Остаток выбранной категории в текущем месяце, без выбора — по всем лимитам этого scope */
export function ExpenseSummary({ scope, cats, sel }: { scope: Scope; cats: Category[]; sel: Category | undefined }) {
	const { data } = useTracker()
	const st = data.settings!
	const key = curMonthKey()
	const list = (scope === 'personal' ? data.myExpenses : data.familyExpenses)[key] ?? []
	const plan = data.plans[key]
	const ov = scope === 'personal' ? plan?.myOverrides : plan?.familyOverrides
	// Лимит месяца с поправкой плана; траты по плану не входят, кроме превышения пункта
	const spent = planSpentByCat(list, (scope === 'personal' ? plan?.items.mine : plan?.items.family) ?? [])
	const ids = new Set(sel ? [sel.id] : cats.map((c) => c.id))
	const limit = (sel ? [sel] : cats).reduce((acc, c) => acc + monthLimit(c, key, ov), 0)
	const used = [...ids].reduce((a, id) => a + (spent[id] ?? 0), 0)
	const left = limit - used
	// Мобильный: одна строка; WARNING (от 80%) и перерасход окрашивают её, как статус шкалы
	const pct = limit > 0 ? used / limit : used > 0 ? Infinity : 0
	const tone = pct > 1 ? 'text-bad' : pct >= 0.8 ? 'text-warn' : 'text-muted'
	const title = sel ? termName(sel.name) : 'Все лимиты'

	return (
		<section className="mt-6 border-t border-dashed border-line pt-4 sm:pt-6" aria-live="polite">
			<p className={`text-[13px] uppercase sm:hidden ${tone}`}>
				{title} · {left < 0 ? `Перерасход ${fmt(-left)} из ${fmt(limit)}` : `Осталось ${fmt(left)} из ${fmt(limit)}`}
			</p>
			<h2 className="sec max-sm:hidden">{title}</h2>
			<div className="mt-3 max-sm:hidden">
				<AsciiBar value={used} max={limit} label={sel ? sel.name : 'Все лимиты'} />
			</div>
			<p className="mt-2 uppercase max-sm:hidden">
				<span className={left < 0 ? 'text-bad' : 'text-muted'}>
					{left < 0 ? `Перерасход ${fmt(-left)} ${st.base}` : `Осталось ${fmt(left)} из ${fmt(limit)} ${st.base}`}
				</span>
				{scope === 'family' && (
					<>
						<span className="text-muted"> // </span>
						<Contribution sums={byAuthor(list, (e) => ids.has(e.catId))} />
					</>
				)}
			</p>
		</section>
	)
}
