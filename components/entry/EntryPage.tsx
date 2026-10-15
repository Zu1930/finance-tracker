'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTracker } from '../TrackerProvider'
import { EntryForm, useAltPick, useEntryForm, type EntryMode } from './EntryForm'
import { ExpenseSummary } from './ExpenseSummary'
import { ExpenseLogs } from './ExpenseLogs'
import { IncomeBalance } from './IncomeBalance'
import { IncomeLogs } from './IncomeLogs'
import {
	activeCats,
	byRecentUse,
	fmt,
	incomeKeyOf,
	incomeSources,
	monthKeyOf,
	termName,
	uid
} from '@/lib/utils'

/** Последняя валюта помнится отдельно для трат и поступлений */
const CUR_KEYS: Record<EntryMode, string> = {
	expense: 'ft:cur',
	income: 'ft:income-cur'
}

/** Ввод трат и поступлений на одной странице. Режим живёт в URL: /?mode=income */
export function EntryPage() {
	const { data, addExpense, removeExpense, addIncome, removeIncome, toast } =
		useTracker()
	const st = data.settings!
	const router = useRouter()
	const mode: EntryMode =
		useSearchParams().get('mode') === 'income' ? 'income' : 'expense'
	const rootRef = useRef<HTMLDivElement>(null)

	// Порядок категорий = последние использованные первыми; от него зависят номера и Alt + 1..9
	const cats = byRecentUse(activeCats(st), data.months)
	const sources = incomeSources(st)

	// Форма общая для обоих режимов и не сбрасывается при переключении
	const form = useEntryForm(CUR_KEYS[mode])
	const [catId, setCatId] = useState<string | null>(null)
	// Поступления почти всегда из одного источника, поэтому выбор не сбрасывается после записи
	const [srcId, setSrcId] = useState(sources[0].id)
	const src = sources.find((s) => s.id === srcId) ?? sources[0]

	const setMode = (m: EntryMode, focusAmount: boolean) => {
		if (m !== mode) {
			form.setError('')
			router.replace(m === 'income' ? '/?mode=income' : '/', { scroll: false })
		}
		if (focusAmount) form.amountRef.current?.focus()
	}

	// Alt + ← — расход, Alt + → — доход. Фокус в сумму, только если он уже был в форме
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
			e.preventDefault()
			const inForm = rootRef.current?.contains(document.activeElement) ?? false
			setMode(e.key === 'ArrowLeft' ? 'expense' : 'income', inForm)
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	})

	useAltPick(mode === 'expense' ? cats : sources, (id) => {
		if (mode === 'expense') setCatId(id)
		else setSrcId(id)
		form.setError('')
	})

	const recorded = (what: string, undo: () => void) => {
		form.reset()
		toast(`Записано: ${what}`, 'Отменить', undo)
	}

	const submit = () => {
		if (mode === 'expense') {
			const cat = cats.find((c) => c.id === catId)
			const entry = form.collect(() => (cat ? null : 'Выберите категорию.'))
			if (!entry || !cat) return
			const e = { id: uid(), ...entry, catId: cat.id }
			addExpense(e)
			setCatId(null)
			recorded(`−${fmt(e.amount)} ${e.currency} → ${termName(cat.name)}`, () =>
				removeExpense(monthKeyOf(e.date), e.id)
			)
		} else {
			const entry = form.collect()
			if (!entry) return
			const i = { id: uid(), ...entry, sourceId: src.id }
			addIncome(i)
			recorded(`+${fmt(i.amount)} ${i.currency} → ${termName(src.name)}`, () =>
				removeIncome(incomeKeyOf(i.date), i.id)
			)
		}
	}

	return (
		<>
			<div ref={rootRef}>
				<h1 className="sr-only">
					{mode === 'expense' ? 'Новый расход' : 'Новый доход'}
				</h1>
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
					<div
						className="flex"
						role="group"
						aria-label="Тип записи"
					>
						{(['expense', 'income'] as const).map((m) => (
							<button
								key={m}
								className="tb min-h-11 px-4 not-first:-ml-px aria-[pressed=false]:text-muted"
								aria-pressed={mode === m}
								onClick={() => setMode(m, true)}
							>
								{m === 'expense' ? '− Расход' : '+ Доход'}
							</button>
						))}
					</div>
					<p className="text-muted2 uppercase">
						Alt + ← / → // или «+» перед суммой
					</p>
				</div>
				<EntryForm
					mode={mode}
					form={form}
					options={mode === 'expense' ? cats : sources}
					selectedId={mode === 'expense' ? catId : src.id}
					onPick={(id) =>
						mode === 'expense'
							? setCatId(catId === id ? null : id)
							: setSrcId(id)
					}
					onPlus={() => setMode('income', false)}
					onSubmit={submit}
				/>
			</div>

			{mode === 'expense' ? (
				<>
					<ExpenseSummary
						cats={cats}
						sel={cats.find((c) => c.id === catId)}
					/>
					<ExpenseLogs />
				</>
			) : (
				<>
					<IncomeBalance />
					<IncomeLogs />
				</>
			)}
		</>
	)
}
