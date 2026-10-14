'use client'

import { useState } from 'react'
import { useTracker } from './TrackerProvider'
import { AsciiBar } from './AsciiBar'
import { EntryFields, useAltPick, useEntryForm } from './EntryForm'
import {
	curMonthKey,
	fmt,
	incomeKeyOf,
	incomeSources,
	monthTitle,
	termName,
	todayStr,
	uid
} from '@/lib/utils'

const CUR_KEY = 'ft:income-cur'
/** Сколько месяцев логов показывать до «Показать все» */
const MONTHS_SHOWN = 6

export function IncomeView() {
	const { data, addIncome, removeIncome, toast } = useTracker()
	const st = data.settings!
	const sources = incomeSources(st)

	const form = useEntryForm(CUR_KEY)
	// Поступления почти всегда из одного источника, поэтому выбор не сбрасывается после записи
	const [srcId, setSrcId] = useState(sources[0].id)
	const src = sources.find((s) => s.id === srcId) ?? sources[0]
	useAltPick(sources, (id) => {
		setSrcId(id)
		form.setError('')
	})
	const [showAll, setShowAll] = useState(false)

	const sourceName = (id: string) =>
		termName(sources.find((s) => s.id === id)?.name ?? 'Удалённый источник')

	const submit = () => {
		const entry = form.collect()
		if (!entry) return
		const i = { id: uid(), ...entry, sourceId: src.id }
		addIncome(i)
		form.reset()
		toast(
			`Записано: +${fmt(i.amount)} ${i.currency} → ${termName(src.name)}`,
			'Отменить',
			() => removeIncome(incomeKeyOf(i.date), i.id)
		)
	}

	const remove = (key: string, id: string) => {
		const gone = removeIncome(key, id)
		if (gone) toast('Удалено', 'Вернуть', () => addIncome(gone))
	}

	// Баланс текущего месяца
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

	// Логи: месяцы от новых к старым, внутри месяца — новые сверху
	const groups = Object.keys(data.incomes)
		.sort()
		.reverse()
		.map((key) => ({
			key,
			items: [...data.incomes[key].items].sort(
				(a, b) => b.date.localeCompare(a.date) || b.ts - a.ts
			)
		}))
		.filter((g) => g.items.length > 0)
	const shown = showAll ? groups : groups.slice(0, MONTHS_SHOWN)

	return (
		<>
			<h1 className="sec">New income</h1>
			<EntryFields
				form={form}
				amountLabel="Amount +"
				optionsTitle="Source"
				options={sources}
				selectedId={src.id}
				onPick={setSrcId}
				gridClassName="grid-cols-2 sm:grid-cols-5"
				notePlaceholder="например: аванс, проект, возврат"
				onSubmit={submit}
			/>

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

			<section className="mt-10 max-sm:pb-24">
				<h2 className="sec">Income logs</h2>
				{groups.length === 0 ? (
					<p className="mt-3 text-muted uppercase">
						Поступлений пока нет. Введите сумму выше.
					</p>
				) : (
					<>
						<div className="mt-1 overflow-x-auto">
							<div className="grid min-w-[860px] grid-cols-[repeat(5,auto)_minmax(0,1fr)_auto] gap-x-4">
								{shown.map((g) => (
									<section
										key={g.key}
										className="col-span-full grid grid-cols-subgrid"
									>
										<h3 className="col-span-full mt-3 flex justify-between border-b border-dashed border-line2 py-2 text-muted uppercase">
											<span>-- {monthTitle(g.key)}</span>
											<span>
												+{fmt(g.items.reduce((a, i) => a + i.base, 0))}{' '}
												{st.base}
											</span>
										</h3>
										{g.items.map((i) => (
											<div
												key={i.id}
												className="col-span-full grid grid-cols-subgrid items-center border-b border-dashed border-line2 py-1 whitespace-nowrap"
											>
												<span className="text-muted">{i.date}</span>
												<span className="text-muted">[REV]</span>
												<b className="text-right">
													+{fmt(i.amount)} {i.currency}
												</b>
												<span className="text-muted">
													{i.currency !== st.base && `(≈ ${fmt(i.base)})`}
												</span>
												<span>// {sourceName(i.sourceId)}</span>
												<span className="min-w-0 truncate text-muted">
													{i.note || '—'}
												</span>
												<button
													className="xb"
													aria-label="Удалить поступление"
													onClick={() => remove(g.key, i.id)}
												>
													×
												</button>
											</div>
										))}
									</section>
								))}
							</div>
						</div>
						{groups.length > MONTHS_SHOWN && !showAll && (
							<button
								className="tb mt-4"
								onClick={() => setShowAll(true)}
							>
								Показать все
							</button>
						)}
					</>
				)}
			</section>
		</>
	)
}
