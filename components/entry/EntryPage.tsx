'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTracker } from '../TrackerProvider'
import { useSpace } from '../SpaceProvider'
import { useNarrow } from '../AsciiBar'
import { EntryForm, useAltPick, type EntryMode } from './EntryForm'
import { useEntryDraft } from './useEntryDraft'
import { MonthFeed } from './MonthFeed'
import { CanSpend, PlanRow } from '../limits/MobileLimits'
import { Icon } from '../icons/Icon'
import { Feed } from './Feed'
import { curMonthKey, fmt, isMac, termName } from '@/lib/utils'
import { itemLeft } from '@/lib/plan'
import { DueBlock } from '../recurring/DueBlock'
import { QuickEntry } from './QuickEntry'
import { WithSetupCard } from '../onboarding/SetupCard'
import { Hint } from '../onboarding/Hint'
import type { ParsedEntry } from '@/lib/quick-entry/parse'
import { IconText } from '../icons/IconText'
import { t } from '@/lib/i18n'

/** Телефон — лента с итогом (ввод — формой поверх неё по «+»), десктоп — ввод, лента месяца и итог рядом */
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
	const [formOpen, setFormOpen] = useState(!!data.mySettings.hideQuickEntry || mode === 'income')

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
		setFormOpen(true)
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

	const cur = curMonthKey()
	const formBlock = (
		<details className="border-t border-dashed border-line pt-3" open={formOpen} onToggle={(e) => setFormOpen(e.currentTarget.open)}>
			<summary className="cursor-pointer text-muted uppercase">:: {t('cmd.form')} <span className="text-[13px] text-muted2 normal-case">{t('cmd.formHint')}</span></summary>
			<div ref={rootRef} className="mt-3">
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
		</details>
	)

	return (
		<WithSetupCard>
			{/* Ввод | лента | колонка 300px; уже 1280px колонка уходит под ленту */}
			<div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_300px]">
				<section aria-label={t('nav.entry')} className="flex min-w-0 flex-col gap-3.5">
					{readOnly ? (
						<div className="flex flex-col gap-2.5 border border-dashed border-line p-4">
							<h1><IconText name="view">{t('cmd.readOnly')}</IconText></h1>
							<div className="flex flex-wrap gap-1.5">
								<button className="tb" onClick={() => setSpace('family')}><IconText name="space-family">{t('cmd.toFamily')}</IconText></button>
								<button className="tb" onClick={() => setSpace('personal')}><IconText name="space-personal">{t('cmd.toPersonal')}</IconText></button>
							</div>
						</div>
					) : (
						<>
							{!data.mySettings.hideQuickEntry && (
								<QuickEntry familyCats={isSolo ? [] : d.familyCats} personalCats={d.personalCats} defaultScope={scope} onEdit={editParsed} />
							)}
							<Hint id="voice" />
							{!isSolo && <Hint id="family" />}
							{formBlock}
							{mode === 'expense' && hasMine && <Hint id="entry" />}
						</>
					)}
				</section>
				<MonthFeed />
				<aside aria-label={t('budget.canSpend')} className="flex flex-col gap-4 lg:col-start-2 xl:col-start-auto">
					<CanSpend month={cur} />
					{!readOnly && <DueBlock />}
					<PlanRow month={cur} />
					<p className="flex gap-2 text-[13px] text-muted2"><Icon name="shortcut" size={16} className="shrink-0" />{t('cmd.keysHint', { k: isMac() ? '⌘ K' : 'Ctrl + K' })}</p>
				</aside>
			</div>
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
