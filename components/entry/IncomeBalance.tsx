'use client'

import { useTracker } from '../TrackerProvider'
import { AsciiBar } from '../AsciiBar'
import { curMonthKey, fmt, incomeKeyOf, monthTitle, todayStr } from '@/lib/utils'

/** Баланс текущего месяца: получено против потрачено */
export function IncomeBalance() {
	const { data } = useTracker()
	const st = data.settings!
	const got = (data.incomes[incomeKeyOf(todayStr())]?.items ?? []).reduce(
		(a, i) => a + i.base,
		0
	)
	const spent = (data.months[curMonthKey()]?.expenses ?? []).reduce(
		(a, e) => a + e.base,
		0
	)
	const top = Math.max(got, spent)
	const rest = got - spent

	return (
		<section
			className="mt-6 border-t border-dashed border-line pt-6"
			aria-live="polite"
		>
			<h2 className="sec">{monthTitle(curMonthKey())} // Баланс</h2>
			<div className="mt-3 space-y-1 uppercase">
				{[
					{ label: 'Получено', value: got, text: `+${fmt(got)}` },
					{ label: 'Потрачено', value: spent, text: `−${fmt(spent)}` }
				].map((r) => (
					// На мобильном шкала уходит на отдельную строку под меткой и суммой
					<div
						key={r.label}
						className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 sm:grid-cols-[10ch_minmax(0,1fr)_auto]"
					>
						<span className="text-muted">{r.label}</span>
						<div className="col-span-full max-sm:order-last sm:col-span-1">
							<AsciiBar
								value={r.value}
								max={top}
								bare
								label={r.label}
							/>
						</div>
						<b className="text-right">
							{r.text} {st.base}
						</b>
					</div>
				))}
			</div>
			{got > 0 ? (
				<p className="mt-3 uppercase">
					<span className={rest < 0 ? 'text-bad' : 'text-ink'}>
						Остаток {rest < 0 ? '−' : '+'}
						{fmt(Math.abs(rest))} {st.base}
					</span>
					<span className="text-muted">
						{' '}
						// Отложить можно {Math.max(0, Math.round((rest / got) * 100))}%
						дохода
					</span>
				</p>
			) : (
				<p className="mt-3 text-muted uppercase">
					Поступлений в этом месяце нет
				</p>
			)}
		</section>
	)
}
