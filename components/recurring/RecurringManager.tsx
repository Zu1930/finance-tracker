'use client'

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTracker } from '../TrackerProvider'
import { amountIn, nextUnpaidMonth } from '@/lib/recurring'
import type { Category, RecurringPayment, Scope } from '@/lib/types'
import { MONTHS, aliveIn, amountChars, curMonthKey, fmt, limitIn, parseAmount, setLimit, shiftMonth, termName, todayStr } from '@/lib/utils'

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** :: РЕГУЛЯРНЫЕ ПЛАТЕЖИ — управление: список с правкой, пауза, удаление, форма создания */
export function RecurringManager() {
	const { data, api, scopeTag } = useTracker()
	const st = data.settings!
	const live = [...data.recurring.family, ...data.recurring.mine].filter((p) => !p.endMonth)
	const [edit, setEdit] = useState<string | null>(null)
	const cats = (scope: Scope) => (scope === 'personal' ? data.mySettings.personalCategories : st.familyCategories)
	const catName = (p: RecurringPayment) => termName(cats(p.scope).find((c) => c.id === p.categoryId)?.name ?? 'категория удалена')
	const cur = curMonthKey()
	const when = (p: RecurringPayment) =>
		p.frequency === 'monthly' ? `каждый месяц, ${String(p.day).padStart(2, '0')}` : `раз в год, ${p.day} ${MONTHS_GEN[(p.month ?? 1) - 1]}`

	const remove = (p: RecurringPayment) => void api(`/api/recurring/${p.id}?scope=${p.scope}&today=${todayStr()}`, 'DELETE')

	return (
		<details className="group mt-2 border-t border-dashed border-line">
			<summary className="sec flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
				↻ Регулярные платежи<span aria-hidden="true" className="group-open:hidden">[+]</span><span aria-hidden="true" className="hidden group-open:inline">[−]</span>
			</summary>
			<div className="max-w-3xl pt-1 pb-2">
				{live.length === 0 && <p className="text-muted uppercase">Платежей пока нет</p>}
				<ul>
					{live.map((p) =>
						edit === p.id ? (
							<EditPayment key={p.id} p={p} onDone={() => setEdit(null)} />
						) : (
							<li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-dashed border-line2 py-1 uppercase sm:flex sm:min-h-11 sm:flex-wrap">
								<button className="min-w-0 truncate text-left hover:underline sm:flex-1" onClick={() => setEdit(p.id)} aria-label={`Изменить ${p.name}`}>
									<b className={p.paused ? 'text-muted' : ''}>{termName(p.name)}</b>
									<span className="text-muted max-sm:hidden"> // {catName(p)}</span>
								</button>
								<span className="text-right">
									{p.approx && '≈ '}{fmt(amountIn(p, cur))} {p.currency}
								</span>
								<span className="truncate text-xs text-muted sm:text-sm">
									{when(p)}{scopeTag(p.scope) && ` · ${scopeTag(p.scope)}`}{p.paused && <b className="text-warn"> · Пауза</b>}
								</span>
								<span className="flex items-center justify-end gap-2">
									{p.paused && <button className="tb" onClick={() => void api(`/api/recurring/${p.id}`, 'PATCH', { scope: p.scope, version: p.version, paused: false })}>Возобновить</button>}
									<button className="xb -mr-2" aria-label={`Удалить ${p.name}`} onClick={() => remove(p)}>×</button>
								</span>
							</li>
						)
					)}
				</ul>
				<NewPayment cats={cats} />
			</div>
		</details>
	)
}

/** Правка: имя, сумма (с этого месяца или со следующего), день, точная/примерная */
function EditPayment({ p, onDone }: { p: RecurringPayment; onDone: () => void }) {
	const { data, api, toast } = useTracker()
	const today = todayStr()
	const expenses = Object.values(p.scope === 'personal' ? data.myExpenses : data.familyExpenses).flat()
	const cur = today.slice(0, 7)
	const [name, setName] = useState(p.name)
	const [sum, setSum] = useState(String(amountIn(p, cur)))
	const [day, setDay] = useState(String(p.day))
	const [approx, setApprox] = useState(p.approx)
	const [from, setFrom] = useState(nextUnpaidMonth(p, today, expenses))
	const changedSum = parseAmount(sum) !== amountIn(p, cur)

	const save = async () => {
		const a = parseAmount(sum), d = Number(day)
		if (!name.trim() || !a || !(a > 0) || !(d >= 1 && d <= 31)) return toast('Проверьте название, сумму и день.')
		const res = await api(`/api/recurring/${p.id}`, 'PATCH', {
			scope: p.scope, version: p.version, name: name.trim(), day: Math.round(d), approx,
			...(changedSum && { amount: a, fromMonth: from }),
		})
		if (res) onDone()
	}
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Enter') void save()
		if (e.key === 'Escape') onDone()
	}

	return (
		<li className="space-y-3 border-b border-dashed border-line2 py-3">
			<div className="flex flex-wrap items-end gap-x-6 gap-y-3">
				<Field label="Name" id={`rn-${p.id}`} grow><input id={`rn-${p.id}`} className="tfield flex-1" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} /></Field>
				<Field label="Sum" id={`rs-${p.id}`}><input id={`rs-${p.id}`} className="tfield flex-1 text-right" inputMode="decimal" value={sum} onChange={(e) => setSum(amountChars(e.target.value))} onKeyDown={onKey} /><span className="text-muted">{p.currency}</span></Field>
				<Field label="День" id={`rd-${p.id}`}><input id={`rd-${p.id}`} className="tfield w-[6ch] text-right" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} onKeyDown={onKey} /></Field>
			</div>
			<div className="tgroup" role="group" aria-label="Точность суммы">
				<button className="tb" aria-pressed={!approx} onClick={() => setApprox(false)}>Точно</button>
				<button className="tb" aria-pressed={approx} onClick={() => setApprox(true)}>≈ Примерно</button>
			</div>
			{changedSum && (
				<div className="tgroup" role="group" aria-label="С какого месяца новая сумма">
					<button className="tb" aria-pressed={from === cur} onClick={() => setFrom(cur)}>С {MONTHS_GEN[Number(cur.slice(5)) - 1]}</button>
					<button className="tb" aria-pressed={from !== cur} onClick={() => setFrom(shiftMonth(cur, 1))}>Со следующего месяца</button>
				</div>
			)}
			<div className="tgroup">
				<button className="tb" onClick={onDone}>Отмена</button>
				<button className="tb font-bold" onClick={() => void save()}>Сохранить</button>
			</div>
		</li>
	)
}

function Field({ label, id, grow, children }: { label: string; id: string; grow?: boolean; children: ReactNode }) {
	return (
		<div className={`flex items-center gap-3 max-sm:w-full ${grow ? 'min-w-[200px] flex-[2_1_200px]' : 'min-w-[140px] flex-[1_1_140px]'}`}>
			<label htmlFor={id} className="lbl">{label}</label>
			{children}
		</div>
	)
}

/** Форма нового платежа. После ежемесячного — предложение уменьшить лимит категории на его сумму */
function NewPayment({ cats }: { cats: (s: Scope) => Category[] }) {
	const { data, isSolo, api, toast, setSettings, setMySettings } = useTracker()
	const st = data.settings!
	const cur = curMonthKey()
	const [name, setName] = useState('')
	const [sum, setSum] = useState('')
	const [approx, setApprox] = useState(false)
	const [currency, setCurrency] = useState(st.base)
	const [yearly, setYearly] = useState(false)
	const [day, setDay] = useState('1')
	const [month, setMonth] = useState(Number(cur.slice(5)))
	const [picked, setScope] = useState<Scope>('family')
	const scope: Scope = isSolo ? 'personal' : picked
	const [catId, setCatId] = useState<string | null>(null)
	const [offer, setOffer] = useState<{ cat: Category; scope: Scope; from: number; to: number; name: string } | null>(null)
	const list = cats(scope).filter((c) => aliveIn(c, cur))

	const add = async () => {
		const a = parseAmount(sum), d = Number(day)
		if (!name.trim()) return toast('Назовите платёж.')
		if (!a || !(a > 0)) return toast('Укажите сумму.')
		if (!(d >= 1 && d <= 31)) return toast('День — от 1 до 31.')
		const cat = list.find((c) => c.id === catId)
		if (!cat) return toast('Выберите категорию.')
		const res = await api('/api/recurring', 'POST', {
			name: name.trim(), amount: a, currency, approx, frequency: yearly ? 'yearly' : 'monthly', day: Math.round(d),
			...(yearly && { month }), categoryId: cat.id, scope, startMonth: cur,
		})
		if (!res) return
		// Ежемесячный платёж раньше, скорее всего, жил внутри лимита категории — предложить его уменьшить
		const rate = currency === st.base ? 1 : st.rates[currency]
		const limit = limitIn(cat, cur)
		if (!yearly && rate && limit >= a * rate) setOffer({ cat, scope, from: limit, to: Math.round(limit - a * rate), name: name.trim() })
		setName('')
		setSum('')
	}
	const reduce = () => {
		if (!offer) return
		const update = (all: Category[]) => all.map((c) => (c.id === offer.cat.id ? setLimit(c, offer.to, cur) : c))
		if (offer.scope === 'family') setSettings((s) => ({ ...s!, familyCategories: update(s!.familyCategories) }))
		else setMySettings((s) => ({ ...s, personalCategories: update(s.personalCategories) }))
		setOffer(null)
	}
	const onEnter = (e: KeyboardEvent) => e.key === 'Enter' && void add()

	return (
		<div className="mt-4 space-y-3">
			{offer && (
				<div className="border border-dashed border-line2 px-3 py-2 uppercase">
					<p>Лимит {termName(offer.cat.name)} {fmt(offer.from)} → <b>{fmt(offer.to)}</b>?</p>
					<p className="text-muted2">// {termName(offer.name)} теперь учитывается отдельно</p>
					<div className="tgroup mt-2">
						<button className="tb font-bold" onClick={reduce}>Уменьшить</button>
						<button className="tb" onClick={() => setOffer(null)}>Оставить</button>
					</div>
				</div>
			)}
			<div className="flex flex-wrap items-end gap-x-6 gap-y-3">
				<Field label="Name" id="rec-name" grow><input id="rec-name" className="tfield flex-1" placeholder="например, интернет" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} /></Field>
				<Field label="Sum" id="rec-sum"><input id="rec-sum" className="tfield flex-1 text-right" inputMode="decimal" placeholder={currency} value={sum} onChange={(e) => setSum(amountChars(e.target.value))} onKeyDown={onEnter} /></Field>
			</div>
			<div className="flex flex-wrap gap-x-6 gap-y-3">
				<div className="tgroup max-sm:w-full" role="group" aria-label="Точность суммы">
					<button className="tb" aria-pressed={!approx} onClick={() => setApprox(false)}>Точно</button>
					<button className="tb" aria-pressed={approx} onClick={() => setApprox(true)}>≈ Примерно</button>
				</div>
				<div className="tgroup max-sm:w-full" role="group" aria-label="Валюта платежа">
					{st.currencies.map((c) => <button key={c} className="tb tb-tight" aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c}</button>)}
				</div>
			</div>
			<div className="flex flex-wrap items-end gap-x-6 gap-y-3">
				<div className="tgroup max-sm:w-full" role="group" aria-label="Периодичность">
					<button className="tb" aria-pressed={!yearly} onClick={() => setYearly(false)}>Каждый месяц</button>
					<button className="tb" aria-pressed={yearly} onClick={() => setYearly(true)}>Раз в год</button>
				</div>
				<Field label="День" id="rec-day"><input id="rec-day" className="tfield w-[6ch] text-right" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} onKeyDown={onEnter} /></Field>
				{yearly && (
					<Field label="Месяц" id="rec-month">
						<select id="rec-month" className="tfield flex-1 uppercase" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
							{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
						</select>
					</Field>
				)}
			</div>
			{!isSolo && (
				<div className="tgroup max-sm:w-full sm:w-max" role="group" aria-label="Чей платёж">
					<button className="tb" aria-pressed={scope === 'family'} onClick={() => { setScope('family'); setCatId(null) }}>Семья</button>
					<button className="tb" aria-pressed={scope === 'personal'} onClick={() => { setScope('personal'); setCatId(null) }}>Личное</button>
				</div>
			)}
			<div className="flex flex-wrap gap-2" role="group" aria-label="Категория платежа">
				{list.map((c) => <button key={c.id} className="tb tb-tight" aria-pressed={catId === c.id} onClick={() => setCatId(c.id)}>{termName(c.name)}</button>)}
				{list.length === 0 && <span className="text-muted uppercase">Нет категорий</span>}
			</div>
			<button className="tb max-sm:h-12 max-sm:w-full" onClick={() => void add()}>+ Добавить</button>
			
		</div>
	)
}
