'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTracker } from '../TrackerProvider'
import { useSpace } from '../SpaceProvider'
import { Icon } from '../icons/Icon'
import { IconText, spaceIcon } from '../icons/IconText'
import { t } from '@/lib/i18n'
import { unlinks } from '@/lib/entry-edit'
import { SPACE, feedRows, groupByDay, type FeedRow } from '@/lib/space'
import { REQUIRED } from '@/lib/summary'
import { IncomeLine } from './IncomeLine'
import type { Expense, Income, Scope } from '@/lib/types'
import { amountChars, curMonthKey, ddmm, fmt, incomeSources, liveCats, minus, monthName, numIn, parseAmount, termName, todayStr } from '@/lib/utils'

const META = 'text-xs text-muted uppercase'

/**
 * Лента месяца выбранного бюджета на десктопе, по дням. Строка раскрывает правку на месте (PATCH /api/entries/:id).
 * Фильтры из «Итогов» и «Лимитов»: ?cat=<id>[&scope=…][&month=YYYY-MM], cat=required — обязательные
 */
export function MonthFeed() {
	const { data, isSolo } = useTracker()
	const { view, readOnly } = useSpace()
	const params = useSearchParams()
	const cat = params.get('cat'), catScope = params.get('scope')
	const month = params.get('month') ?? curMonthKey()
	const [open, setOpen] = useState<string | null>(null)
	const st = data.settings!
	const cats = new Map([...st.familyCategories, ...data.mySettings.personalCategories].map((c) => [c.id, c.name]))
	const sources = new Map(incomeSources(st).map((s) => [s.id, s.name]))
	const names = new Map([data.me, ...(data.partner ? [data.partner] : [])].map((u) => [u.id, u.name]))
	const rows = feedRows(data, view).filter((r) => r.e.date.startsWith(month) && (!cat || (r.kind === 'expense'
		&& (cat === REQUIRED ? !!r.e.recurringId : r.e.catId === cat && !r.e.recurringId && (!catScope || r.e.scope === catScope)))))
	const days = groupByDay(rows, todayStr())
	const canEdit = !readOnly && !data.readonly
	const key = (r: FeedRow) => `${r.kind}-${r.e.id}`
	const withNames = !isSolo && view !== 'personal'
	// Строка: значок | категория с метой | сумма | правка; на 1920+ — колонки таблицы (у семьи и «всё вместе» — с автором)
	const ROW = `grid items-baseline gap-x-2.5 px-1.5 grid-cols-[1.25rem_minmax(0,1fr)_auto_1.25rem] ${withNames
		? 'huge:grid-cols-[3rem_1.25rem_minmax(0,1fr)_minmax(0,1.2fr)_5rem_auto_1.25rem]'
		: 'huge:grid-cols-[3rem_1.25rem_minmax(0,1fr)_minmax(0,1.2fr)_auto_1.25rem]'}`

	return (
		<section aria-label={t('nav.feed')} className="flex min-w-0 flex-col [grid-area:feed]">
			<div className="mb-1 flex items-baseline justify-between gap-3">
				<h2 className="sec truncate">
					{t('feed.month', { m: monthName(month), s: isSolo ? '' : SPACE[view].name })}
					{cat && ` · ${cat === REQUIRED ? t('summary.required') : termName(cats.get(cat) ?? '—')}`}
				</h2>
				{canEdit && rows.length > 0 && <span className={`shrink-0 ${META}`}>{t('feed.clickToEdit')}</span>}
			</div>
			{/* Доходы личные: в ◆ и ∑ — только сумма каждого за месяц; правка доходов — только в ◇ */}
			{!isSolo && view !== 'personal' && !cat && <IncomeLine month={month} />}
			{days.length === 0 && <p className="mt-4 text-muted uppercase">// Записей пока нет</p>}
			{/* 1920+: лента — таблица (дата, бюджет, категория, заметка, автор, сумма); та же разметка, другая сетка строки */}
			{days.length > 0 && (
				<div aria-hidden="true" className={`hidden ${ROW} border-b border-line pt-3 pb-1 text-xs text-muted huge:grid`}>
					<span>{t('feed.colDate')}</span><span /><span>{t('feed.colWhat')}</span><span>{t('feed.colNote')}</span>
					{withNames && <span>{t('feed.colWho')}</span>}<span className="text-right">{t('feed.colSum')}</span><span />
				</div>
			)}
			{days.map((d) => (
				<div key={d.day}>
					<h3 className="flex justify-between px-1.5 pt-3 pb-1 text-xs text-muted huge:hidden">
						<span>{d.title}</span>
						<span>{d.spent > 0 ? minus(d.spent) : ''}</span>
					</h3>
					<ul>
						{d.rows.map((r) => {
							const income = r.kind === 'income'
							const e = r.e
							const what = income ? sources.get((e as Income).sourceId) : cats.get((e as Expense).catId)
							const who = withNames ? [names.get(e.authorId) ?? '—'] : []
							const note = [...(e.currency !== st.base ? [`${fmt(e.amount)} ${e.currency}`] : []), ...(e.note ? [e.note] : [])].join(' · ')
							const meta = [...who, ...(note ? [note] : [])].join(' · ')
							const k = key(r)
							return (
								<li key={k} className="border-b border-dashed border-line2">
									<button className={`${ROW} w-full py-2 text-left uppercase enabled:hover:bg-hover`}
										disabled={!canEdit} aria-expanded={canEdit ? open === k : undefined} onClick={() => setOpen(open === k ? null : k)}>
										<span className="hidden text-xs text-muted huge:block">{ddmm(e.date)}</span>
										<span className={!income && (e as Expense).scope === 'personal' ? 'text-muted' : ''}>
											{!isSolo && <Icon name={income ? 'income' : spaceIcon((e as Expense).scope)} size={16} />}
										</span>
										<span className="truncate">{termName(what ?? '—')} {meta && <span className="text-xs text-muted normal-case huge:hidden">{meta}</span>}</span>
										<span className="hidden truncate text-xs text-muted normal-case huge:block">{note}</span>
										{withNames && <span className="hidden truncate text-xs text-muted huge:block">{who}</span>}
										<b className="text-right">{income ? '+' : '−'}{fmt(e.base)}</b>
										<span className="text-muted">{canEdit && <Icon name="note" size={16} />}</span>
									</button>
									{canEdit && open === k && <EditRow row={r} onDone={() => setOpen(null)} />}
								</li>
							)
						})}
					</ul>
				</div>
			))}
		</section>
	)
}

/** Правка на месте: сумма, категория (источник), бюджет, дата, заметка; удалить; «Сохранить» */
function EditRow({ row, onDone }: { row: FeedRow; onDone: () => void }) {
	const { data, isSolo, api, toast, removeEntry, restoreEntry } = useTracker()
	const st = data.settings!
	const income = row.kind === 'income'
	const e = row.e
	const ex = e as Expense
	const [amount, setAmount] = useState(numIn(e.amount))
	const [scope, setScope] = useState<Scope>(income ? 'family' : ex.scope)
	const [catId, setCatId] = useState(income ? (e as Income).sourceId : ex.catId)
	const [date, setDate] = useState(e.date)
	const [note, setNote] = useState(e.note)
	const [busy, setBusy] = useState(false)
	const options = income ? incomeSources(st) : liveCats(scope === 'family' ? st.familyCategories : data.mySettings.personalCategories)
	// Архивная или удалённая категория записи тоже должна быть в списке
	const list = options.some((o) => o.id === catId) ? options : [{ id: catId, name: '—' }, ...options]
	const mine = e.authorId === data.me.id
	const u = income ? null : unlinks(ex, { catId, scope, date })
	const value = parseAmount(amount)

	const pickScope = (s: Scope) => {
		setScope(s)
		const next = liveCats(s === 'family' ? st.familyCategories : data.mySettings.personalCategories)
		if (!next.some((c) => c.id === catId)) setCatId(next[0]?.id ?? catId)
	}
	const save = async () => {
		if (!value || !(value > 0)) return
		setBusy(true)
		const entry = { ...e, amount: value, base: Math.round(value * e.rate * 100) / 100, date, note: note.trim(), ...(income ? { sourceId: catId } : { catId, scope }) }
		const res = await api(`/api/entries/${encodeURIComponent(e.id)}`, 'PATCH', { kind: row.kind, scope: income ? 'family' : ex.scope, month: e.date.slice(0, 7), seen: e, entry })
		setBusy(false)
		if (!res) return
		toast(t('edit.saved'))
		onDone()
	}
	const remove = () => {
		onDone()
		removeEntry(row.kind, e)
		toast('Удалено', 'Вернуть', () => restoreEntry(row.kind, e))
	}

	return (
		<div className="flex flex-col gap-2 bg-hover px-1.5 pt-2.5 pb-3">
			<div className="flex flex-wrap items-center gap-2">
				<label className="flex items-center gap-1.5">
					<span className="sr-only">{t('edit.amount')}</span>
					<input className="tfield w-[12ch] text-right font-bold" inputMode="decimal" autoFocus value={amount}
						onChange={(x) => setAmount(amountChars(x.target.value))} onKeyDown={(x) => x.key === 'Enter' && void save()} />
					<span className={META}>{e.currency}</span>
				</label>
				<label className="min-w-0">
					<span className="sr-only">{income ? t('edit.source') : t('edit.category')}</span>
					<select className="tfield max-w-[24ch] uppercase" value={catId} onChange={(x) => setCatId(x.target.value)}>
						{list.map((c) => <option key={c.id} value={c.id}>{termName(c.name)}</option>)}
					</select>
				</label>
				{!income && !isSolo && (
					<div className="flex" role="group" aria-label={t('space.budget')}>
						{(['family', 'personal'] as const).map((s) => (
							<button key={s} className="tb tb-tight not-first:-ml-px" aria-pressed={scope === s} disabled={!mine && s !== ex.scope} onClick={() => pickScope(s)}>
								<IconText name={spaceIcon(s)}>{SPACE[s].name}</IconText>
							</button>
						))}
					</div>
				)}
				<label>
					<span className="sr-only">{t('edit.date')}</span>
					<input type="date" className="tfield" value={date} onChange={(x) => x.target.value && setDate(x.target.value)} />
				</label>
			</div>
			<label className="flex items-center gap-2">
				<span className="sr-only">{t('edit.note')}</span>
				<input className="tfield min-w-0 flex-1" placeholder={t('edit.note')} maxLength={140} value={note} onChange={(x) => setNote(x.target.value)}
					onKeyDown={(x) => x.key === 'Enter' && void save()} />
			</label>
			{u?.plan && <p className="text-[0.8125rem] text-warn">{t('edit.unlinkPlan')}</p>}
			{u?.recurring && <p className="text-[0.8125rem] text-warn">{t('edit.unlinkRecurring')}</p>}
			{!income && !mine && !isSolo && <p className="text-[0.8125rem] text-muted2">{t('edit.notAuthor')}</p>}
			<div className="flex items-center justify-between gap-2">
				<button className="ib text-muted hover:text-bad" onClick={remove}><Icon name="trash" size={16} label={t('action.delete')} /></button>
				<button className="tbox min-h-10 border-ink bg-ink px-4 font-bold text-panel uppercase hover:bg-ink" disabled={busy || !value || !(value > 0)} onClick={() => void save()}>
					{t('edit.save')}
				</button>
			</div>
		</div>
	)
}
