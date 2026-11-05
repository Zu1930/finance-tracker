'use client'

import Link from 'next/link'
import { useTracker } from './TrackerProvider'
import { useSpace, useSpaceData } from './SpaceProvider'
import { AsciiBar } from './AsciiBar'
import { dueRows } from './recurring/DueBlock'
import { abbr, byAuthor, monthExpense } from '@/lib/metrics'
import { inSpace } from '@/lib/space'
import { living } from '@/lib/plan-view'
import { Icon } from './icons/Icon'
import { IconText } from './icons/IconText'
import { t } from '@/lib/i18n'
import type { ReactNode } from 'react'
import { curMonthKey, fmt, monthName, monthTitle, todayStr } from '@/lib/utils'

/** Итог бюджета: верх ленты на мобильном */
export function SpaceSummary() {
	const { data, isSolo } = useTracker()
	const { view, readOnly } = useSpace()
	const sd = useSpaceData()
	const st = data.settings!
	const key = curMonthKey()
	const { limit, left } = living(data, view, key, todayStr())
	const now = new Date()
	const day = now.getDate()
	const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
	// Первые 3 дня — мало данных, как у прогноза
	const pace = day > 3 ? monthExpense(sd, key) / day : null
	const paceText = `ТЕМП ${pace === null ? '—' : `${fmt(Math.abs(pace) >= 100 ? Math.round(pace) : pace)}/ДЕНЬ`}`
	// Просроченные регулярные бюджета — ведут к блоку «К оплате»
	const overdue = dueRows(data, todayStr()).filter((r) => r.status === 'overdue' && inSpace(r.payment.scope, view)).length

	const month = monthName(key).toUpperCase()
	const label = `${t('budget.canSpend')} · ${!isSolo && view === 'all' ? 'семья + моё' : month}`
	let sub: ReactNode
	if (!isSolo && view === 'family') {
		const by = byAuthor(data.familyExpenses[key] ?? [])
		sub = [...[data.me, ...(data.partner ? [data.partner] : [])].map((u) => `${u.name} ${fmt(Math.round(by[u.id] ?? 0))}`), paceText].join(' · ')
	} else if (!isSolo && view === 'all') {
		sub = (
			<span className="inline-flex flex-wrap items-center gap-x-2">
				<Icon name="space-family" size={16} />{t('space.family')} {fmt(Math.round(living(data, 'family', key, todayStr()).left))} ·
				<Icon name="space-personal" size={16} />{t('space.mine')} {fmt(Math.round(living(data, 'personal', key, todayStr()).left))}
			</span>
		)
	} else sub = paceText
	const note = !isSolo && view === 'personal' ? <IconText name="lock">{t('space.onlyYou')}</IconText>
		: readOnly && !data.readonly ? <IconText name="view">{t('space.readOnly')}</IconText> : null
	const overdueLink = overdue > 0 && (
		<Link href="/#due" className="text-warn hover:underline">{overdue} не {overdue === 1 ? 'отмечен' : 'отмечены'}</Link>
	)

	return (
			<div className="border-y border-dashed border-line py-3 uppercase">
				<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-muted">
					<span>
						[ {label}: <b className={left < 0 ? 'text-bad' : 'text-ink'}>{fmt(Math.round(left))}</b> из {fmt(Math.round(limit))} ]
					</span>
					<span>[ {sub} ]</span>
					<span>
						[ {monthTitle(key)} // {day}/{days} // BASE: <b className="text-ink">{st.base}</b>
						{overdueLink && <> // {overdueLink}</>} ]
					</span>
				</div>
				{note && <p className="mt-1 text-muted2 normal-case">{note}</p>}
			</div>
		)

	return (
		<section aria-label="Итог" className="flex flex-col gap-1.5 border-b border-dashed border-line pb-3.5 uppercase">
			<p className="text-xs text-muted">{label}</p>
			<p className="flex items-baseline gap-2">
				<b className={`text-[2.125rem] leading-tight tracking-tight ${left < 0 ? 'text-bad' : ''}`}>{fmt(Math.round(left))}</b>
				<span className="text-xs text-muted">из {fmt(Math.round(limit))} {st.base}</span>
			</p>
			<AsciiBar value={limit - left} max={limit} bare={false} narrowWidth={24} label={label} />
			<p className="text-xs text-muted">
				{sub} · {abbr(key)} {day}/{days}
				{overdueLink && <> · {overdueLink}</>}
			</p>
			{note && <p className="text-[0.8125rem] text-muted2 normal-case">{note}</p>}
		</section>
	)
}
