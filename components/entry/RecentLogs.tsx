'use client'

import { useState } from 'react'
import { useTracker } from '../TrackerProvider'
import { useSpace } from '../SpaceProvider'
import type { Expense, Income } from '@/lib/types'
import { ddmm, fmt, incomeSources, termName } from '@/lib/utils'
import { feedRows, type FeedRow } from '@/lib/space'
import { Icon } from '../icons/Icon'
import { spaceIcon } from '../icons/IconText'
import { t } from '@/lib/i18n'

/** Сколько строк показывать сразу и сколько добавлять по «Показать ещё» */
const PAGE = 30

type Row = FeedRow

/** Записи бюджета (lib/space.ts feedRows) — новые сверху; в «всё вместе» у строки символ её бюджета */
export function RecentLogs() {
	const { data, isSolo, removeEntry, restoreEntry, toast } = useTracker()
	const { view, readOnly } = useSpace()
	// Архив и «всё вместе» — только просмотр
	const noEdit = !!data.readonly || readOnly
	const st = data.settings!
	const [shown, setShown] = useState(PAGE)
	// Имена авторов не нужны в личном: там только мои записи
	const withNames = !isSolo && view !== 'personal'
	const tag = (r: Row) => (isSolo || r.kind === 'income' ? null : <Icon name={spaceIcon((r.e as Expense).scope)} size={16} label={(r.e as Expense).scope === 'personal' ? t('space.personal') : t('space.family')} />)

	const cats = new Map([...st.familyCategories, ...data.mySettings.personalCategories].map((c) => [c.id, c.name]))
	const sources = new Map(incomeSources(st).map((s) => [s.id, s.name]))
	const names = new Map([...Object.entries(data.names ?? {}), ...[data.me, ...(data.partner ? [data.partner] : [])].map((u) => [u.id, u.name] as const)])

	const rows = feedRows(data, view)

	const remove = (r: Row) => {
		removeEntry(r.kind, r.e)
		toast('Удалено', 'Вернуть', () => restoreEntry(r.kind, r.e))
	}

	return (
		<section className="mt-10">
			<h2 className="sec">Recent logs</h2>
			{rows.length === 0 ? (
				<p className="mt-3 text-muted uppercase">// Записей пока нет</p>
			) : (
				<>
					{/* Мобильный: список, у записи две строки — что | сумма, дата · кто · где | [×] */}
					<ul className="mt-2 sm:hidden">
						{rows.slice(0, shown).map((r) => {
							const income = r.kind === 'income'
							const e = r.e
							const what = income ? sources.get((e as Income).sourceId) : cats.get((e as Expense).catId)
							const meta = [
								ddmm(e.date),
								...(withNames ? [names.get(e.authorId) ?? '—'] : []),

								...(e.currency !== st.base ? [`${fmt(e.amount)} ${e.currency}`] : []),
								...(e.note ? [e.note] : []),
							]
							return (
								<li key={`${r.kind}-${e.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-dashed border-line2 pt-2 uppercase">
									<span className="flex min-w-0 items-center gap-2"><span className={(e as Expense).scope === 'personal' ? 'text-muted' : ''}>{tag(r)}</span><span className="truncate">{termName(what ?? (income ? 'Удалённый источник' : 'Удалённая категория'))}</span></span>
									<b className="text-right">{income ? '+' : '−'}{fmt(e.base)}</b>
									<span className="truncate text-xs text-muted">{meta.join(' · ')}</span>
									<button className={`ib -mr-3 justify-self-end ${noEdit ? 'invisible' : ''}`} onClick={() => remove(r)}><Icon name="trash" size={16} label={income ? 'Удалить доход' : 'Удалить трату'} /></button>
								</li>
							)
						})}
					</ul>
					<div className="mt-3 hidden overflow-x-auto sm:block">
						<ul className="grid min-w-max grid-cols-[repeat(4,auto)_minmax(16ch,1fr)_auto_auto] gap-x-4">
							{rows.slice(0, shown).map((r) => {
								const income = r.kind === 'income'
								const e = r.e
								const what = income ? sources.get((e as Income).sourceId) : cats.get((e as Expense).catId)
								return (
									<li key={`${r.kind}-${e.id}`} className="col-span-7 grid grid-cols-subgrid items-center border-b border-dashed border-line2 py-1 whitespace-nowrap">
										<span className="text-muted">{e.date}</span>
										<span className="text-muted">{income ? '[REV]' : '[EXP]'}</span>
										<span className={(e as Expense).scope === 'personal' ? 'text-muted' : ''}>{tag(r)}</span>
										<span className="text-right font-bold">
											{income ? '+' : '−'}
											{fmt(e.amount)} {e.currency}
											{e.currency !== st.base && <span className="ml-2 font-normal text-muted">(≈ {fmt(e.base)} {st.base})</span>}
										</span>
										<span className="min-w-0 truncate">
											// {termName(what ?? (income ? 'Удалённый источник' : 'Удалённая категория'))}
											{e.note && <span className="ml-2 text-muted">{e.note}</span>}
										</span>
										<span className="text-muted uppercase">{withNames ? (names.get(e.authorId) ?? '—') : ''}</span>
										<button className={`ib ${noEdit ? 'invisible' : ''}`} onClick={() => remove(r)}><Icon name="trash" size={16} label={income ? 'Удалить доход' : 'Удалить трату'} /></button>
									</li>
								)
							})}
						</ul>
					</div>
					{rows.length > shown && (
						<button className="tb mt-4" onClick={() => setShown((n) => n + PAGE)}>
							Показать ещё
						</button>
					)}
				</>
			)}
		</section>
	)
}
