'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTracker } from '../TrackerProvider'
import { useSpace } from '../SpaceProvider'
import { SpaceSummary } from '../SpaceSummary'
import { DueBlock } from '../recurring/DueBlock'
import { WithSetupCard } from '../onboarding/SetupCard'
import { requestEntry } from './MobileEntry'
import { IncomeLine } from './IncomeLine'
import type { Expense, Income } from '@/lib/types'
import { feedRows, groupByDay, type FeedRow } from '@/lib/space'
import { REQUIRED } from '@/lib/summary'
import { Icon } from '../icons/Icon'
import { IconText, spaceIcon } from '../icons/IconText'
import { t } from '@/lib/i18n'
import { curMonthKey, fmt, incomeSources, minus, monthName, termName, todayStr } from '@/lib/utils'

const PAGE = 40

/** Лента на телефоне: итог бюджета, «К оплате», записи по дням. Нажатие на строку — её действия */
export function Feed() {
	const { data, isSolo, removeEntry, restoreEntry, toast } = useTracker()
	const { view, readOnly } = useSpace()
	const st = data.settings!
	const params = useSearchParams()
	const [shown, setShown] = useState(PAGE)
	const [open, setOpen] = useState<string | null>(null)

	// /?focus=amount — из опроса и карточки «Настройка»: сразу форма ввода
	const focus = params.get('focus') === 'amount'
	useEffect(() => {
		if (!focus) return
		window.history.replaceState(null, '', window.location.pathname)
		if (!readOnly) requestEntry({})
	}, [focus, readOnly])

	const cats = new Map([...st.familyCategories, ...data.mySettings.personalCategories].map((c) => [c.id, c.name]))
	const sources = new Map(incomeSources(st).map((s) => [s.id, s.name]))
	const names = new Map([...Object.entries(data.names ?? {}), ...[data.me, ...(data.partner ? [data.partner] : [])].map((u) => [u.id, u.name] as const)])
	// /?cat=<id>[&scope=…][&month=YYYY-MM] — из «Лимитов» и «Итогов»: только траты этой категории (cat=required — обязательные)
	const cat = params.get('cat')
	const catScope = params.get('scope')
	const inMonth = params.get('month')
	const rows = feedRows(data, view).filter((r) => !cat || (r.kind === 'expense' && (cat === REQUIRED ? !!r.e.recurringId
		: r.e.catId === cat && !r.e.recurringId && (!catScope || r.e.scope === catScope)) && (!inMonth || r.e.date.startsWith(inMonth))))
	const days = groupByDay(rows.slice(0, shown), todayStr())
	const withNames = !isSolo && view !== 'personal'
	const actions = !readOnly && !data.readonly
	const keyOf = (r: FeedRow) => `${r.kind}-${r.e.id}`

	const remove = (r: FeedRow) => {
		setOpen(null)
		removeEntry(r.kind, r.e)
		toast('Удалено', 'Вернуть', () => restoreEntry(r.kind, r.e))
	}

	return (
		<WithSetupCard>
			<h1 className="sr-only">Лента</h1>
			<SpaceSummary />
			{actions && !cat && <div className="mt-4"><DueBlock /></div>}
			{cat && (
				<div className="mt-4 flex items-center justify-between gap-3 border-b border-ink pb-2 uppercase">
					<b className="truncate">{t('feed.byCategory', { x: cat === REQUIRED ? t('summary.required') : termName(cats.get(cat) ?? '—') })}{inMonth && ` · ${monthName(inMonth)}`}</b>
					<Link href="/" replace className="ib"><Icon name="close" size={20} label={t('feed.allEntries')} /></Link>
				</div>
			)}
			<section aria-label="Записи" className="pb-6">
				{/* Доходы личные: в ◆ и ∑ — только сумма каждого за месяц */}
				{withNames && !cat && <div className="mt-3"><IncomeLine month={inMonth ?? curMonthKey()} /></div>}
				{days.length === 0 && <p className="mt-6 text-muted uppercase">// Записей пока нет</p>}
				{days.map((d) => (
					<div key={d.day}>
						<h2 className="flex justify-between pt-3 pb-1 text-xs text-muted">
							<span>{d.title}</span>
							<span>{d.spent > 0 ? minus(d.spent) : ''}</span>
						</h2>
						<ul>
							{d.rows.map((r) => {
								const income = r.kind === 'income'
								const e = r.e
								const personal = !income && (e as Expense).scope === 'personal'
								const what = income ? sources.get((e as Income).sourceId) : cats.get((e as Expense).catId)
								const meta = [
									...(withNames ? [names.get(e.authorId) ?? '—'] : []),
									...(e.currency !== st.base ? [`${fmt(e.amount)} ${e.currency}`] : []),
									...(e.note ? [e.note] : []),
								].join(' · ')
								const k = keyOf(r)
								return (
									<li key={k} className="border-b border-dashed border-line2">
										<button
											className={`grid w-full items-baseline gap-x-2.5 py-2 text-left uppercase ${isSolo ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-[1.125rem_minmax(0,1fr)_auto]'}`}
											aria-expanded={actions ? open === k : undefined}
											disabled={!actions}
											onClick={() => setOpen(open === k ? null : k)}
										>
											{!isSolo && <span className={`self-center ${personal ? 'text-muted' : ''}`}><Icon name={income ? 'income' : spaceIcon((e as Expense).scope)} size={16} /></span>}
											<span className="truncate">{termName(what ?? (income ? 'Удалённый источник' : 'Удалённая категория'))}</span>
											<b className="text-right">{income ? '+' : '−'}{fmt(e.base)}</b>
											{!isSolo && <span />}
											<span className="col-span-2 truncate text-xs text-muted normal-case">{meta || '—'}</span>
										</button>
										{actions && open === k && (
											<div className="flex flex-wrap gap-2 pb-2">
												<button className="tb h-11 px-3" onClick={() => { setOpen(null); requestEntry({ copy: r }) }}><IconText name="note">{t('action.toForm')}</IconText></button>
												<button className="tb h-11 px-3 hover:text-bad" onClick={() => remove(r)}><IconText name="trash">{income ? 'Удалить доход' : t('action.delete')}</IconText></button>
											</div>
										)}
									</li>
								)
							})}
						</ul>
					</div>
				))}
				{rows.length > shown && (
					<button className="tb mt-4 h-11 w-full" onClick={() => setShown((n) => n + PAGE)}>Показать ещё</button>
				)}
			</section>
		</WithSetupCard>
	)
}
