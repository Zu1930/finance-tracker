'use client'

import { useMemo, useState } from 'react'
import { useTracker } from './TrackerProvider'
import { AsciiBar } from './AsciiBar'
import { EntryFields, useAltPick, useEntryForm } from './EntryForm'
import {
	MONTHS,
	activeCats,
	byRecentUse,
	curMonthKey,
	fmt,
	monthKeyOf,
	spentByCat,
	termName,
	uid
} from '@/lib/utils'

const pad = (n: number) => String(n).padStart(2, '0')
const timeOf = (ts: number) => {
	const d = new Date(ts)
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const CUR_KEY = 'ft:cur'

export function InputView() {
	const { data, addExpense, removeExpense, toast } = useTracker()
	const st = data.settings!
	// Порядок = последние использованные первыми; от него зависят номера и Alt + 1..9
	const cats = byRecentUse(activeCats(st), data.months)

	const form = useEntryForm(CUR_KEY)
	const [catId, setCatId] = useState<string | null>(null)
	useAltPick(cats, (id) => {
		setCatId(id)
		form.setError('')
	})

	const key = curMonthKey()
	const monthName = MONTHS[new Date().getMonth()].toLowerCase()
	const expenses = data.months[key]?.expenses ?? []
	const spent = useMemo(() => spentByCat(expenses), [expenses])
	const recent = useMemo(
		() =>
			[...expenses]
				.sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts)
				.slice(0, 20),
		[expenses]
	)
	const catName = (id: string) =>
		termName(
			st.categories.find((c) => c.id === id)?.name ?? 'Удалённая категория'
		)

	const submit = () => {
		const cat = cats.find((c) => c.id === catId)
		const entry = form.collect(() => (cat ? null : 'Выберите категорию.'))
		if (!entry || !cat) return
		const e = { id: uid(), ...entry, catId: cat.id }
		addExpense(e)
		form.reset()
		setCatId(null)
		toast(
			`Записано: ${fmt(e.amount)} ${e.currency} → ${termName(cat.name)}`,
			'Отменить',
			() => removeExpense(monthKeyOf(e.date), e.id)
		)
	}

	const remove = (mKey: string, id: string) => {
		const gone = removeExpense(mKey, id)
		if (gone) toast('Трата удалена', 'Вернуть', () => addExpense(gone))
	}

	const sel = cats.find((c) => c.id === catId)
	const limit = sel ? sel.limit : cats.reduce((acc, c) => acc + c.limit, 0)
	const used = sel
		? (spent[sel.id] ?? 0)
		: cats.reduce((acc, c) => acc + (spent[c.id] ?? 0), 0)
	const left = limit - used

	return (
		<>
			<h1 className="sec">New entry</h1>
			<EntryFields
				form={form}
				amountLabel="Amount"
				optionsTitle="Category"
				options={cats}
				selectedId={catId}
				onPick={(id) => setCatId(catId === id ? null : id)}
				gridClassName="grid-cols-2 sm:grid-cols-4"
				notePlaceholder="необязательно"
				onSubmit={submit}
			/>

			<section
				className="mt-6 border-t border-dashed border-line pt-6"
				aria-live="polite"
			>
				<h2 className="sec">{sel ? termName(sel.name) : 'Все лимиты'}</h2>
				<div className="mt-3">
					<AsciiBar
						value={used}
						max={limit}
						label={sel ? sel.name : 'Все лимиты'}
					/>
				</div>
				<p className={`mt-2 uppercase ${left < 0 ? 'text-bad' : 'text-muted'}`}>
					{left < 0
						? `Перерасход ${fmt(-left)} ${st.base}`
						: `Осталось ${fmt(left)} из ${fmt(limit)} ${st.base}`}
				</p>
			</section>

			<section className="mt-10 max-sm:pb-24">
				<h2 className="sec">Recent logs</h2>
				{recent.length === 0 ? (
					<p className="mt-3 text-muted uppercase">
						// За {monthName} записей пока нет
					</p>
				) : (
					<div className="mt-3 overflow-x-auto">
						<ul className="grid min-w-max grid-cols-[repeat(4,auto)_minmax(16ch,1fr)_auto_auto] gap-x-4">
							{recent.map((e) => (
								<li
									key={e.id}
									className="col-span-7 grid grid-cols-subgrid items-center border-b border-dashed border-line2 py-1 whitespace-nowrap"
								>
									<span className="text-muted">{e.date}</span>
									<span className="text-muted">{timeOf(e.ts)}</span>
									<span className="text-muted">[EXP]</span>
									<span className="text-right font-bold">
										-{fmt(e.amount)}
										{e.currency !== st.base && (
											<span className="ml-2 font-normal text-muted">
												(≈ {fmt(e.base)} {st.base})
											</span>
										)}
									</span>
									<span className="min-w-0 truncate">
										// {catName(e.catId)}
										{e.note && (
											<span className="ml-2 text-muted">{e.note}</span>
										)}
									</span>
									<span className="text-muted">[{e.currency}]</span>
									<button
										className="xb"
										aria-label="Удалить трату"
										onClick={() => remove(monthKeyOf(e.date), e.id)}
									>
										×
									</button>
								</li>
							))}
						</ul>
					</div>
				)}
			</section>
		</>
	)
}
