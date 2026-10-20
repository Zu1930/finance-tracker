'use client'

import { useState, type KeyboardEvent } from 'react'
import { useTracker } from '../TrackerProvider'
import { usePlan } from './usePlan'
import { MAX_AHEAD, itemStatus, monthsAhead } from '@/lib/plan'
import type { PlanItem, Scope } from '@/lib/types'
import { MONTHS_SHORT, aliveIn, amountChars, curMonthKey, fmt, minus, parseAmount, shiftMonth, termName } from '@/lib/utils'

const MARK = { done: '[✓]', partial: '[~]', planned: '[ ]' } as const

/** Плановые покупки месяца: список с переносом и удалением, форма добавления. withStatus — для текущего и прошлых месяцев */
export function PlanItems({ month, withStatus, form = true }: { month: string; withStatus: boolean; form?: boolean }) {
	const { data } = useTracker()
	const { items, linked } = usePlan(month)
	const st = data.settings!
	const catName = (it: PlanItem) => {
		const cats = it.scope === 'personal' ? data.mySettings.personalCategories : st.familyCategories
		const c = cats.find((x) => x.id === it.categoryId)
		return c && !c.archived ? termName(c.name) : 'категория удалена'
	}

	return (
		<section className="mt-6 border-t border-dashed border-line pt-5">
			<h2 className="sec">Покупки</h2>
			{items.length === 0 ? (
				<p className="mt-3 text-muted uppercase">Покупок не запланировано</p>
			) : (
				<ul className="mt-2">
					{items.map((it) => (
						<ItemRow key={it.id} it={it} linked={linked[it.id] ?? 0} cat={catName(it)} withStatus={withStatus} />
					))}
				</ul>
			)}
			{form && <NewItem month={month} />}
		</section>
	)
}

function ItemRow({ it, linked, cat, withStatus }: { it: PlanItem; linked: number; cat: string; withStatus: boolean }) {
	const { api, toast } = useTracker()
	const status = itemStatus(it, linked)
	const next = shiftMonth(it.month, 1)
	const canMove = linked === 0 && it.expenseIds.length === 0 && monthsAhead(curMonthKey(), next) <= MAX_AHEAD
	const url = `/api/plan-items/${it.id}`

	const move = async () => {
		const res = await api<{ item: PlanItem }>(url, 'PATCH', { scope: it.scope, month: it.month, version: it.version, toMonth: next })
		if (!res) return
		toast(`${termName(it.name)} → ${MONTHS_SHORT[Number(next.slice(5)) - 1]}`, 'Отменить', () =>
			void api(url, 'PATCH', { scope: it.scope, month: next, version: res.item.version, toMonth: it.month })
		)
	}
	const remove = async () => {
		if (!(await api(`${url}?scope=${it.scope}&month=${it.month}`, 'DELETE'))) return
		toast(`Покупка ${termName(it.name)} удалена`, 'Вернуть', () =>
			void api('/api/plan-items', 'POST', { name: it.name, amount: it.amount, categoryId: it.categoryId, scope: it.scope, month: it.month })
		)
	}

	return (
		// Мобильный: две строки, как в логах — имя | сумма, категория · scope | [→] [×]
		<li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-dashed border-line2 py-1 uppercase sm:flex sm:min-h-11 sm:flex-wrap">
			<span className="min-w-0 truncate sm:flex-1">
				{withStatus && (
					<span className={`mr-4 ${status === 'planned' ? 'text-muted' : ''}`} aria-label={{ done: 'куплено', partial: 'частично', planned: 'не куплено' }[status]}>
						{MARK[status]}
					</span>
				)}
				<b>{termName(it.name)}</b>
				<span className="text-muted max-sm:hidden"> // {cat}</span>
			</span>
			<span className="text-muted max-sm:hidden">[{it.scope === 'family' ? 'СЕМ' : 'ЛИЧН'}]</span>
			<b className="text-right">
				{withStatus && status === 'partial' ? `${fmt(linked)} из ${fmt(it.amount)}` : minus(it.amount)}
			</b>
			<span className="truncate text-xs text-muted sm:hidden">{cat} · {it.scope === 'family' ? 'СЕМ' : 'ЛИЧН'}</span>
			<span className="flex items-center justify-end gap-2 sm:contents">
				{canMove && (
					<button className="tb" aria-label={`Перенести ${it.name} на следующий месяц`} onClick={() => void move()}>
						→<span className="max-sm:hidden"> {MONTHS_SHORT[Number(next.slice(5)) - 1]}</span>
					</button>
				)}
				<button className="xb -mr-2" aria-label={`Удалить покупку ${it.name}`} onClick={() => void remove()}>×</button>
			</span>
		</li>
	)
}

function NewItem({ month }: { month: string }) {
	const { data, api, toast } = useTracker()
	const st = data.settings!
	const [name, setName] = useState('')
	const [sum, setSum] = useState('')
	const [scope, setScope] = useState<Scope>('family')
	const [catId, setCatId] = useState<string | null>(null)
	const cats = (scope === 'personal' ? data.mySettings.personalCategories : st.familyCategories).filter((c) => aliveIn(c, month))

	const add = async () => {
		const n = name.trim()
		const a = parseAmount(sum)
		if (!n) return toast('Назовите покупку.')
		if (!a || !(a > 0)) return toast('Укажите сумму.')
		if (!catId || !cats.some((c) => c.id === catId)) return toast('Выберите категорию.')
		if (!(await api('/api/plan-items', 'POST', { name: n, amount: a, categoryId: catId, scope, month }))) return
		setName('')
		setSum('')
	}
	const onEnter = (e: KeyboardEvent) => e.key === 'Enter' && void add()

	return (
		<div className="mt-4">
			<div className="flex flex-wrap items-end gap-x-6 gap-y-3">
				<div className="flex min-w-[200px] flex-[2_1_200px] items-center gap-3">
					<label htmlFor="item-name" className="lbl">Name</label>
					<input id="item-name" className="tfield flex-1" placeholder="например, пылесос" value={name}
						onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
				</div>
				<div className="flex min-w-[160px] flex-[1_1_160px] items-center gap-3">
					<label htmlFor="item-sum" className="lbl">Sum</label>
					<input id="item-sum" className="tfield flex-1 text-right" inputMode="decimal" placeholder={st.base} value={sum}
						onChange={(e) => setSum(amountChars(e.target.value))} onKeyDown={onEnter} />
				</div>
				<div className="tgroup max-sm:w-full" role="group" aria-label="Чья покупка">
					{(['family', 'personal'] as const).map((s) => (
						<button key={s} className="tb" aria-pressed={scope === s} onClick={() => { setScope(s); setCatId(null) }}>
							{s === 'family' ? 'Семья' : 'Личное'}
						</button>
					))}
				</div>
			</div>
			<div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Категория покупки">
				{cats.map((c) => (
					<button key={c.id} className="tb tb-tight" aria-pressed={catId === c.id} onClick={() => setCatId(c.id)}>{termName(c.name)}</button>
				))}
				{cats.length === 0 && <span className="text-muted uppercase">Нет категорий</span>}
			</div>
			<button className="tb mt-3 max-sm:h-12 max-sm:w-full" onClick={() => void add()}>+ Добавить</button>
		</div>
	)
}
