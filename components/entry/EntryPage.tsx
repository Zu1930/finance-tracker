'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTracker } from '../TrackerProvider'
import type { Expense, Income, Scope } from '@/lib/types'
import { EntryForm, useAltPick, useEntryForm, type EntryMode } from './EntryForm'
import { ExpenseSummary } from './ExpenseSummary'
import { IncomeBalance } from './IncomeBalance'
import { RecentLogs } from './RecentLogs'
import {
	activeCats,
	liveCats,
	byRecentUse,
	fmt,
	incomeSources,
	termName,
	uid
} from '@/lib/utils'

/** Последняя валюта помнится отдельно для трат и поступлений */
const CUR_KEYS: Record<EntryMode, string> = {
	expense: 'ft:cur',
	income: 'ft:income-cur'
}

/**
 * Ввод трат и поступлений на одной странице. Режим и scope живут в URL: /?mode=income, /?scope=personal.
 * Семейные траты — общие лимиты, личные — свои категории, видит только автор
 */
export function EntryPage() {
	const { data, addEntry, removeEntry, toast } = useTracker()
	const st = data.settings!
	const router = useRouter()
	const params = useSearchParams()
	const mode: EntryMode = params.get('mode') === 'income' ? 'income' : 'expense'
	const scope: Scope = params.get('scope') === 'personal' ? 'personal' : 'family'
	const rootRef = useRef<HTMLDivElement>(null)

	// Порядок категорий = последние использованные первыми; от него зависят номера и Alt + 1..9
	const familyCats = byRecentUse(activeCats(st), data.familyExpenses)
	const personalCats = byRecentUse(liveCats(data.mySettings.personalCategories), data.myExpenses)
	const cats = scope === 'personal' ? personalCats : familyCats
	const sources = incomeSources(st)

	// Форма общая для обоих режимов и не сбрасывается при переключении
	const form = useEntryForm(CUR_KEYS[mode])
	// Выбранная категория — отдельно для семейного и личного
	const [catIds, setCatIds] = useState<Record<Scope, string | null>>({ family: null, personal: null })
	const catId = catIds[scope]
	const setCatId = (id: string | null) => setCatIds((c) => ({ ...c, [scope]: id }))
	// Поступления почти всегда из одного источника, поэтому выбор не сбрасывается после записи
	const [srcId, setSrcId] = useState(sources[0].id)
	const src = sources.find((s) => s.id === srcId) ?? sources[0]

	const go = (m: EntryMode, sc: Scope, focusAmount: boolean) => {
		if (m !== mode || sc !== scope) {
			form.setError('')
			const q = new URLSearchParams()
			if (m === 'income') q.set('mode', 'income')
			if (sc === 'personal') q.set('scope', 'personal')
			router.replace(q.size ? `/?${q}` : '/', { scroll: false })
		}
		if (focusAmount) form.amountRef.current?.focus()
	}

	// Alt + ← / → — расход и доход, Alt + ↑ / ↓ — семья и личное. Фокус в сумму, только если он уже был в форме
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey) return
			const next =
				e.key === 'ArrowLeft' ? (['expense', scope] as const)
				: e.key === 'ArrowRight' ? (['income', scope] as const)
				: e.key === 'ArrowUp' && mode === 'expense' ? (['expense', 'family'] as const)
				: e.key === 'ArrowDown' && mode === 'expense' ? (['expense', 'personal'] as const)
				: null
			if (!next) return
			e.preventDefault()
			go(next[0], next[1], rootRef.current?.contains(document.activeElement) ?? false)
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
			const e: Expense = { id: uid(), ...entry, catId: cat.id, scope, authorId: data.me.id }
			addEntry('expense', e)
			setCatId(null)
			recorded(`−${fmt(e.amount)} ${e.currency} → ${termName(cat.name)}`, () => removeEntry('expense', e))
		} else {
			const entry = form.collect()
			if (!entry) return
			const i: Income = { id: uid(), ...entry, sourceId: src.id, authorId: data.me.id }
			addEntry('income', i)
			recorded(`+${fmt(i.amount)} ${i.currency} → ${termName(src.name)}`, () => removeEntry('income', i))
		}
	}

	const seg = 'tb min-h-11 px-4 not-first:-ml-px aria-[pressed=false]:text-muted'

	return (
		<>
			<div ref={rootRef}>
				<h1 className="sr-only">
					{mode === 'income' ? 'Новый доход' : scope === 'personal' ? 'Новый личный расход' : 'Новый семейный расход'}
				</h1>
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
					<div className="flex" role="group" aria-label="Тип записи">
						{(['expense', 'income'] as const).map((m) => (
							<button key={m} className={seg} aria-pressed={mode === m} onClick={() => go(m, scope, true)}>
								{m === 'expense' ? '− Расход' : '+ Доход'}
							</button>
						))}
					</div>
					{mode === 'expense' && (
						<div className="flex" role="group" aria-label="Чей расход">
							{(['family', 'personal'] as const).map((sc) => (
								<button key={sc} className={seg} aria-pressed={scope === sc} onClick={() => go('expense', sc, true)}>
									{sc === 'family' ? 'Семья' : 'Личное'}
								</button>
							))}
						</div>
					)}
					<p className="text-muted2 uppercase sm:ml-auto">Alt + {mode === 'expense' ? '← → ↑ ↓' : '← →'}</p>
				</div>
				<EntryForm
					mode={mode}
					form={form}
					options={mode === 'expense' ? cats : sources}
					selectedId={mode === 'expense' ? catId : src.id}
					onPick={(id) => (mode === 'expense' ? setCatId(catId === id ? null : id) : setSrcId(id))}
					onPlus={() => go('income', scope, false)}
					onSubmit={submit}
					empty={
						scope === 'personal' && (
							<p className="text-muted uppercase">
								Нет личных категорий →{' '}
								<Link href="/limits" className="tb">Создать</Link>
							</p>
						)
					}
				/>
			</div>

			{mode === 'expense' ? (
				<ExpenseSummary scope={scope} cats={cats} sel={cats.find((c) => c.id === catId)} />
			) : (
				<IncomeBalance />
			)}
			<RecentLogs />
		</>
	)
}
