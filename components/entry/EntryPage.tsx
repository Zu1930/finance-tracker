'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTracker } from '../TrackerProvider'
import { useSpace } from '../SpaceProvider'
import { ReadOnlyPick } from '../SpaceSwitcher'
import { useNarrow } from '../AsciiBar'
import { EntryForm, useAltPick, type EntryMode } from './EntryForm'
import { useEntryDraft } from './useEntryDraft'
import { ExpenseSummary } from './ExpenseSummary'
import { IncomeBalance } from './IncomeBalance'
import { RecentLogs } from './RecentLogs'
import { Feed } from './Feed'
import { fmt, termName } from '@/lib/utils'
import { itemLeft } from '@/lib/plan'
import { DueBlock } from '../recurring/DueBlock'
import { QuickEntry } from './QuickEntry'
import { WithSetupCard } from '../onboarding/SetupCard'
import { Hint } from '../onboarding/Hint'
import type { ParsedEntry } from '@/lib/quick-entry/parse'
import { IconText } from '../icons/IconText'
import { t } from '@/lib/i18n'

/** Телефон — лента с итогом (ввод — формой поверх неё по «+»), десктоп — страница ввода */
export function EntryPage() {
	return useNarrow() ? <Feed /> : <DesktopEntry />
}

/**
 * Ввод трат и поступлений на десктопе. Бюджет — из переключателя в шапке; режим живёт в URL: /?mode=income.
 * Доход — семейный, поэтому только в бюджете «Семья» (и у solo). В «всё вместе» вместо формы — выбор бюджета
 */
function DesktopEntry() {
	const { data, isSolo } = useTracker()
	const { entryScope, readOnly, setSpace } = useSpace()
	const params = useSearchParams()
	const scope = entryScope ?? 'family'
	const incomeOk = isSolo || scope === 'family'
	const mode: EntryMode = params.get('mode') === 'income' && incomeOk ? 'income' : 'expense'
	const rootRef = useRef<HTMLDivElement>(null)
	const d = useEntryDraft(scope, mode)
	const { form } = d

	const go = (m: EntryMode, focusAmount: boolean) => {
		if (m !== mode) {
			form.setError('')
			// Без похода на сервер: useSearchParams видит history.replaceState, и переключение работает без связи
			window.history.replaceState(null, '', m === 'income' ? '/?mode=income' : '/')
		}
		if (focusAmount) form.amountRef.current?.focus()
	}

	// Alt + ← / → — расход и доход. Фокус в сумму, только если он уже был в форме
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
			const next = e.key === 'ArrowRight' && incomeOk ? 'income' : 'expense'
			e.preventDefault()
			go(next, rootRef.current?.contains(document.activeElement) ?? false)
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	})

	useAltPick(mode === 'expense' ? d.cats : d.sources, (id) => {
		if (mode === 'expense') d.setCatId(id)
		else d.setSrcId(id)
		form.setError('')
	}, !isSolo)

	// Трата из голосового ввода → обычная форма; у неё может быть другой бюджет
	const editParsed = (p: ParsedEntry) => {
		d.fillParsed(p)
		if (p.scope !== scope) setSpace(p.scope)
		go('expense', true)
	}

	// Подсказка про сложение сумм — после первой своей траты
	const hasMine = Object.values(data.myExpenses).some((l) => l.length > 0) || Object.values(data.familyExpenses).some((l) => l.some((e) => e.authorId === data.me.id))

	// /?focus=amount — из опроса и карточки «Настройка»
	const focus = params.get('focus') === 'amount'
	useEffect(() => {
		if (!focus) return
		form.amountRef.current?.focus()
		window.history.replaceState(null, '', window.location.pathname)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [focus])

	if (readOnly)
		return (
			<WithSetupCard>
				<h1 className="sr-only">Всё вместе — только просмотр</h1>
				<ReadOnlyPick />
				<RecentLogs />
			</WithSetupCard>
		)

	return (
		<WithSetupCard>
			<DueBlock />
			{mode === 'expense' && !data.mySettings.hideQuickEntry && (
				<>
					<QuickEntry familyCats={isSolo ? [] : d.familyCats} personalCats={d.personalCats} defaultScope={scope} onEdit={editParsed} />
					<Hint id="voice" className="mb-4" />
				</>
			)}
			{!isSolo && <Hint id="family" className="mb-4" />}
			<div ref={rootRef}>
				<h1 className="sr-only">
					{mode === 'income' ? 'Новый доход' : isSolo ? 'Новый расход' : scope === 'personal' ? 'Новый личный расход' : 'Новый семейный расход'}
				</h1>
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
					{incomeOk && (
						<div className="flex" role="group" aria-label="Тип записи">
							{(['expense', 'income'] as const).map((m) => (
								<button key={m} className="tb min-h-11 px-4 not-first:-ml-px aria-[pressed=false]:text-muted" aria-pressed={mode === m} onClick={() => go(m, true)}>
									<IconText name={m}>{m === 'expense' ? t('entry.expense') : t('entry.income')}</IconText>
								</button>
							))}
						</div>
					)}
					{!isSolo && scope === 'personal' && <p className="text-muted2"><IconText name="lock">{t('space.onlyYouEntry')}</IconText></p>}
					<p className="ml-auto text-muted2 uppercase touch:hidden">{incomeOk ? 'Alt + ← → · ' : ''}{isSolo ? '' : 'Бюджет: Alt + 1 2 3'}</p>
				</div>
				<EntryForm
					mode={mode}
					form={form}
					options={mode === 'expense' ? d.cats : d.sources}
					selectedId={mode === 'expense' ? d.catId : d.src.id}
					onPick={(id) => (mode === 'expense' ? d.setCatId(d.catId === id ? null : id) : d.setSrcId(id))}
					onPlus={() => incomeOk && go('income', false)}
					onSubmit={d.submit}
					extra={<PlanChips d={d} />}
					empty={
						scope === 'personal' && (
							<p className="text-muted uppercase">
								Нет {isSolo ? '' : 'личных '}категорий →{' '}
								<Link href="/limits" className="tb">Создать</Link>
							</p>
						)
					}
				/>
			</div>

			{mode === 'expense' && hasMine && <Hint id="entry" className="mt-4" />}
			{mode === 'expense' ? (
				<ExpenseSummary scope={scope} cats={d.cats} sel={d.cats.find((c) => c.id === d.catId)} />
			) : (
				<IncomeBalance />
			)}
			<RecentLogs />
		</WithSetupCard>
	)
}

/** Чипы пунктов плана выбранной категории и «↻ Это <платёж>?» — под категориями */
export function PlanChips({ d, className = 'mt-3 flex flex-wrap gap-2' }: { d: ReturnType<typeof useEntryDraft>; className?: string }) {
	if (d.planChips.length === 0 && !d.match) return null
	return (
		<div className={className} role="group" aria-label="Пункт плана">
			{d.planChips.map((i) => (
				<button key={i.id} className="tb shrink-0" aria-pressed={d.planId === i.id} onClick={() => d.pickPlan(i.id)}>
					<IconText name="plan">План: {termName(i.name)} {fmt(itemLeft(i, d.linked[i.id] ?? 0))}</IconText>
				</button>
			))}
			{d.match && (
				<button className="tb shrink-0" aria-pressed={d.recId === d.match.paymentId} onClick={() => d.pickRecurring(d.match!.paymentId)}>
					<IconText name="recurring">Это {termName(d.match.name)}?</IconText>
				</button>
			)}
		</div>
	)
}
