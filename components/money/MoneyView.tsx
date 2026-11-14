'use client'

import { Fragment, useState, type ReactNode } from 'react'
import { useTracker } from '../TrackerProvider'
import { useSpace, useSpaceData } from '../SpaceProvider'
import { useNarrow } from '../AsciiBar'
import { BTN, PRIMARY, Sheet } from '../limits/parts'
import { focusNoScroll } from '../useSheet'
import { Icon } from '../icons/Icon'
import { IconText, spaceIcon } from '../icons/IconText'
import { Hint } from '../onboarding/Hint'
import { t } from '@/lib/i18n'
import { average, abbr } from '@/lib/metrics'
import { runway } from '@/lib/savings'
import { goalTotal, ledgerHistory, ledgerTotals, myAccounts, myLedger, myPart, visibleGoals, type MyAccount } from '@/lib/ledger-ui'
import type { Account, Goal, Scope } from '@/lib/types'
import { amountChars, curMonthKey, ddmm, fmt, numIn, parseAmount, shiftMonth, signed, termName, todayStr } from '@/lib/utils'

const ROW = 'flex min-h-[3.25rem] w-full items-center justify-between gap-2.5 border-b border-dashed border-line2 py-3 text-left'
const META = 'text-xs text-muted uppercase'
const HINT = 'text-[0.8125rem] text-muted2'
const MONTHS = 6

/**
 * «Деньги»: всего и на цели, счета, цели, как менялось. Баланс счёта считается из записей (lib/ledger.ts):
 * доход пополняет, трата списывает, ручной ввод — только корректировка одного счёта. Итог — по выбранному бюджету.
 * Телефон — одна колонка и шторки; десктоп — две колонки, история раскрыта
 */
export function MoneyView() {
	const narrow = useNarrow()
	const { data, isSolo } = useTracker()
	const { view } = useSpace()
	const sd = useSpaceData()
	const st = data.settings!
	const mine = myLedger(data, todayStr())
	const { total, onGoals, free, missing } = ledgerTotals(data, view, mine)
	const months = view === 'personal' ? null : runway(free, average(sd, todayStr())?.expense)
	const since = data.savings.ledger?.since
	const label = isSolo || view === 'personal' ? t('money.totalMine') : view === 'family' ? t('money.totalFamily') : t('money.totalAll')

	const head = (
		<section aria-label={label} className="flex flex-col gap-1.5 pb-1.5">
			<span className={META}>{label}</span>
			<p className="flex items-baseline gap-2">
				<b className="text-[2rem] leading-tight tracking-tight">{fmt(Math.round(total))}</b>
				<span className={META}>{st.base}</span>
			</p>
			<span aria-hidden="true" className="flex h-1.5 bg-line2">
				<span className="bg-ink" style={{ width: `${total > 0 ? Math.min(100, Math.max(0, (onGoals / total) * 100)) : 0}%` }} />
			</span>
			<span className={`flex justify-between ${META}`}>
				<span>{t('money.onGoals')} {fmt(Math.round(onGoals))}</span>
				<span className={free < 0 ? 'text-bad' : ''}>{t('money.free')} {fmt(Math.round(free))}</span>
			</span>
			{months !== null && (
				<span>{t('money.runway')} <b className={months < 1 ? 'text-warn' : ''}>{t('money.runwayMonths', { x: fmt(months) })}</b> {t('money.runwayTail')}</span>
			)}
			{missing.length > 0 && <span className="text-warn"><IconText name="warning">{t('money.noRate', { x: missing.join(', ') })}</IconText></span>}
			{since && <span className={HINT}>{t('money.balanceFrom', { d: ddmm(since) })}</span>}
			{!isSolo && view === 'personal' && <span className={HINT}><IconText name="lock">{t('space.onlyYou')}</IconText></span>}
		</section>
	)

	if (narrow)
		return (
			<div className="flex flex-col gap-2">
				{head}
				<Hint id="savings" />
				<AccountsBlock />
				<GoalsBlock />
				<History total={total} />
			</div>
		)
	// Десктоп: колонки — .l-money в app/globals.css (две; на 1920+ — три)
	return (
		<div className="l-money">
			<div className="flex flex-col gap-3 [grid-area:main]">
				{head}
				<Hint id="savings" />
				<GoalsBlock />
			</div>
			<div className="flex flex-col gap-3 [grid-area:side]">
				<AccountsBlock />
			</div>
			<div className="flex flex-col gap-3 [grid-area:hist]">
				<History total={total} open />
			</div>
		</div>
	)
}

const glyph = (scope: Scope) => <Icon name={spaceIcon(scope)} size={16} className={`shrink-0 ${scope === 'personal' ? 'text-muted' : ''}`} label={t(scope === 'family' ? 'space.family' : 'space.personal')} />

/** На телефоне — шторка, на десктопе — раскрытый блок под строкой */
function Panel({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
	const narrow = useNarrow()
	if (narrow)
		return (
			<Sheet label={label} onClose={onClose}>
				<div className="flex items-center justify-between gap-2">
					<b className="min-w-0 truncate uppercase">{label}</b>
					<button className="ib" onClick={onClose}><Icon name="close" size={20} label={t('action.close')} /></button>
				</div>
				<div className="mt-2 flex min-h-0 flex-col gap-3 overflow-y-auto">{children}</div>
			</Sheet>
		)
	return <div className="flex flex-col gap-3 border-b border-dashed border-line2 py-3">{children}</div>
}

/** :: СЧЕТА — мои счета: баланс из записей, под цели, свободно; нажатие — карточка */
export function AccountsBlock() {
	const { data } = useTracker()
	const { readOnly } = useSpace()
	const st = data.settings!
	const list = myLedger(data, todayStr())
	const [open, setOpen] = useState<string | null>(null)
	const [adding, setAdding] = useState(false)
	const canWrite = !readOnly && !data.readonly
	return (
		<section aria-label={t('money.accounts')} className="mt-2.5">
			<h2 className="sec">{t('money.accounts')}</h2>
			{list.length === 0 && <p className={`mt-2 ${HINT}`}>{t('money.noAccounts')}</p>}
			<ul>
				{list.map((s) => {
					const a = s.account
					return (
						<li key={a.id}>
							<button className={ROW} aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
								<span className="flex min-w-0 flex-col">
									<span className="min-w-0 truncate uppercase">{a.name}</span>
									{s.reserved > 0 && (
										<span className={`${META} ${s.overdrawn ? 'text-bad' : ''}`}>{t('money.reserved')} {fmt(s.reserved)} · {t('money.free')} {fmt(s.free)}</span>
									)}
								</span>
								<span className="flex shrink-0 flex-col items-end">
									<b>{fmt(s.balance)} {a.currency}</b>
									{a.currency !== st.base && <span className={META}>{s.inBase === null ? '?' : `≈ ${fmt(Math.round(s.inBase))} ${st.base}`}</span>}
								</span>
							</button>
							{open === a.id && <AccountCard s={s} canWrite={canWrite} onClose={() => setOpen(null)} />}
						</li>
					)
				})}
			</ul>
			{canWrite && (adding ? <NewAccount first={list.length === 0} onClose={() => setAdding(false)} /> : (
				<button className={`${BTN} mt-2 uppercase`} onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('money.addAccount')}</button>
			))}
		</section>
	)
}

function AccountCard({ s, canWrite, onClose }: { s: MyAccount; canWrite: boolean; onClose: () => void }) {
	const { api, toast } = useTracker()
	const a = s.account
	const [name, setName] = useState(a.name)
	const [tab, setTab] = useState<'adjust' | 'transfer' | null>(null)
	const rename = async () => {
		const n = name.trim()
		if (!n || n === a.name) return onClose()
		if (await api(`/api/accounts/${a.id}`, 'PATCH', { scope: a.scope, version: a.version, name: n })) onClose()
	}
	const archive = async () => {
		if (s.balance !== 0) return toast(t('money.archiveFirst'))
		const res = await api<{ item: Account }>(`/api/accounts/${a.id}`, 'PATCH', { scope: a.scope, version: a.version, archived: true })
		if (!res) return
		onClose()
		toast(t('money.archived', { x: a.name }), t('money.restore'), () => void api(`/api/accounts/${a.id}`, 'PATCH', { scope: a.scope, version: res.item.version, archived: false }))
	}
	return (
		<Panel label={a.name} onClose={onClose}>
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
				<dt className={META}>{t('money.balance')}</dt><dd className="text-right font-bold">{fmt(s.balance)} {a.currency}</dd>
				<dt className={META}>{t('money.reserved')}</dt><dd className="text-right">{fmt(s.reserved)} {a.currency}</dd>
				<dt className={META}>{t('money.free')}</dt><dd className={`text-right ${s.overdrawn ? 'font-bold text-bad' : ''}`}>{fmt(s.free)} {a.currency}</dd>
			</dl>
			{s.overdrawn && <p className="text-bad"><IconText name="warning">{t('money.overdrawn')}</IconText></p>}
			{canWrite && (
				<>
					<div className="flex flex-wrap gap-2">
						<button className={`${BTN} uppercase`} aria-pressed={tab === 'adjust'} onClick={() => setTab(tab === 'adjust' ? null : 'adjust')}>{t('money.adjust')}</button>
						<button className={`${BTN} uppercase`} aria-pressed={tab === 'transfer'} onClick={() => setTab(tab === 'transfer' ? null : 'transfer')}>{t('money.transfer')}</button>
					</div>
					{tab === 'adjust' && <Adjust s={s} onDone={onClose} />}
					{tab === 'transfer' && <Transfer s={s} onDone={onClose} />}
					<label className="flex items-center gap-3">
						<span className="lbl">{t('money.accountName')}</span>
						<input className="tfield min-w-0 flex-1" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void rename()} />
					</label>
					<div className="flex flex-wrap gap-2">
						<button className={`${BTN} font-bold uppercase`} onClick={() => void rename()}>{t('money.save')}</button>
						<button className={`${BTN} uppercase hover:text-bad`} onClick={() => void archive()}><Icon name="archive" size={16} />{t('money.archive')}</button>
					</div>
				</>
			)}
		</Panel>
	)
}

/** Корректировка: фактический остаток → разница записывается adjustment, не тратой и не доходом */
function Adjust({ s, onDone }: { s: MyAccount; onDone: () => void }) {
	const { api, toast } = useTracker()
	const [val, setVal] = useState(numIn(s.balance))
	const save = async () => {
		// Остаток может быть меньше нуля (кредитка): ведущий минус
		const neg = val.trim().startsWith('-')
		const abs = parseAmount(val.trim().replace(/^-/, ''))
		if (abs === null || Number.isNaN(abs)) return toast(t('money.balance'))
		const v = neg ? -abs : abs
		const res = await api<{ move: { amount: number } | null }>(`/api/accounts/${s.account.id}/adjust`, 'POST', { actual: v, day: todayStr() })
		if (!res) return
		onDone()
		toast(res.move ? t('money.adjusted', { x: `${fmt(v)} ${s.account.currency}`, d: signed(res.move.amount) }) : t('money.adjustSame'))
	}
	return (
		<div className="flex flex-col gap-2">
			<span className={HINT}>{t('money.adjustHint')}</span>
			<div className="flex items-center gap-3">
				<input ref={focusNoScroll} className="tfield min-w-0 flex-1 text-right text-[1.375rem]" inputMode="decimal" aria-label={t('money.balance')} value={val}
					onChange={(e) => setVal(amountChars(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && void save()} />
				<span className={META}>{s.account.currency}</span>
			</div>
			<button className={`${PRIMARY} h-12 uppercase`} onClick={() => void save()}>{t('money.save')}</button>
		</div>
	)
}

/** Перевод: на свой другой счёт или партнёру (на его основной счёт — его счета не видны) */
function Transfer({ s, onDone }: { s: MyAccount; onDone: () => void }) {
	const { data, api, toast, isSolo } = useTracker()
	const others = myAccounts(data).filter((a) => a.id !== s.account.id)
	const targets = [
		...others.map((a) => ({ id: a.id, name: a.name, currency: a.currency as string | null })),
		...(!isSolo && data.partner ? [{ id: `user:${data.partner.id}`, name: t('money.toPartner', { x: data.partner.name }), currency: null }] : []),
	]
	const [to, setTo] = useState(targets[0]?.id ?? '')
	const [val, setVal] = useState('')
	const [got, setGot] = useState('')
	const target = targets.find((x) => x.id === to)
	// Своя другая валюта — можно указать, сколько пришло; партнёру и без суммы — по текущему курсу
	const foreign = !!target?.currency && target.currency !== s.account.currency
	const send = async () => {
		const v = parseAmount(val)
		if (!target || !v || !(v > 0)) return
		const g = foreign && got.trim() ? parseAmount(got) : undefined
		if (!(await api('/api/transfers', 'POST', { accountId: s.account.id, toAccountId: target.id, amount: v, ...(g && g > 0 && { toAmount: g }), day: todayStr() }))) return
		onDone()
		toast(t('money.transferDone', { x: `${fmt(v)} ${s.account.currency}`, to: target.name }))
	}
	if (!targets.length) return <span className={HINT}>{t('money.noAccounts')}</span>
	return (
		<div className="flex flex-col gap-2">
			<span className={HINT}>{t('money.transferHint')}</span>
			<div className="flex flex-wrap gap-1.5" role="group" aria-label={t('money.transferTo')}>
				{targets.map((x) => <button key={x.id} className="tb" aria-pressed={to === x.id} onClick={() => setTo(x.id)}>{x.name}</button>)}
			</div>
			<div className="flex items-center gap-3">
				<input ref={focusNoScroll} className="tfield min-w-0 flex-1 text-right text-[1.375rem]" inputMode="decimal" placeholder={t('money.amount')} aria-label={t('money.amount')} value={val}
					onChange={(e) => setVal(amountChars(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && void send()} />
				<span className={META}>{s.account.currency}</span>
			</div>
			{foreign && (
				<div className="flex items-center gap-3">
					<input className="tfield min-w-0 flex-1 text-right" inputMode="decimal" placeholder={t('money.amount')} aria-label={`${t('money.amount')} ${target!.currency}`} value={got}
						onChange={(e) => setGot(amountChars(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && void send()} />
					<span className={META}>{target!.currency}</span>
				</div>
			)}
			<button className={`${PRIMARY} h-12 uppercase`} onClick={() => void send()}>{t('money.transfer')}</button>
		</div>
	)
}

function NewAccount({ first, onClose }: { first: boolean; onClose: () => void }) {
	const { data, api, toast } = useTracker()
	const st = data.settings!
	const [name, setName] = useState('')
	const [cur, setCur] = useState(st.base)
	const [bal, setBal] = useState('')
	const add = async () => {
		const n = name.trim()
		const b = bal.trim() ? parseAmount(bal) : 0
		if (!n) return
		if (b === null || Number.isNaN(b)) return toast(t('money.balance'))
		// Счёт всегда личный; первый — основной
		if (await api('/api/accounts', 'POST', { name: n, currency: st.currencies.includes(cur) ? cur : st.base, balance: b, primary: first, day: todayStr() })) onClose()
	}
	return (
		<div className="mt-3 flex flex-col gap-3">
			<input ref={focusNoScroll} className="tfield" placeholder={t('money.accountName')} aria-label={t('money.accountName')} value={name} maxLength={40}
				onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
			<div className="flex flex-wrap items-center gap-3">
				<input className="tfield min-w-0 flex-1 text-right" inputMode="decimal" placeholder="0" aria-label={t('money.balance')} value={bal}
					onChange={(e) => setBal(amountChars(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && void add()} />
				<Currencies value={cur} onChange={setCur} />
			</div>
			<div className="flex gap-2">
				<button className={`${BTN} uppercase`} onClick={onClose}>{t('money.cancel')}</button>
				<button className={`${BTN} font-bold uppercase`} onClick={() => void add()}>{t('money.add')}</button>
			</div>
		</div>
	)
}

function Currencies({ value, onChange }: { value: string; onChange: (c: string) => void }) {
	const st = useTracker().data.settings!
	if (st.currencies.length < 2) return null
	return (
		<div className="tgroup" role="group" aria-label={t('entry.currency')}>
			{st.currencies.map((c) => <button key={c} className="tb tb-tight" aria-pressed={value === c} onClick={() => onChange(c)}>{c}</button>)}
		</div>
	)
}

/** :: ЦЕЛИ — строка: имя, «X ИЗ Y», полоска; нажатие — прогресс, вклад по людям, отложить и вернуть со своего счёта */
export function GoalsBlock() {
	const { data } = useTracker()
	const { view, readOnly, entryScope } = useSpace()
	const goals = visibleGoals(data, view)
	const [open, setOpen] = useState<string | null>(null)
	const [adding, setAdding] = useState(false)
	const canWrite = !readOnly && !data.readonly
	return (
		<section aria-label={t('money.goals')} className="mt-3.5">
			<h2 className="sec">{t('money.goals')}</h2>
			{goals.length === 0 && <p className={`mt-2 ${HINT}`}>{t('money.noGoals')}</p>}
			<ul>
				{goals.map((g) => {
					const got = goalTotal(data, g, view)
					return (
						<li key={g.id}>
							<button className={`${ROW} flex-col items-stretch gap-1.5`} aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
								<span className="flex justify-between gap-2">
									<span className="flex min-w-0 items-center gap-2.5">{view === 'all' && glyph(g.scope)}<span className="min-w-0 truncate uppercase">{g.name}</span></span>
									<span className={`shrink-0 ${META}`}>{t('money.goalOf', { x: fmt(got), y: fmt(g.target) })}{g.currency !== data.settings!.base && ` ${g.currency}`}</span>
								</span>
								<span aria-hidden="true" className="flex h-1 bg-line2"><span className="bg-ink" style={{ width: `${Math.min(100, (got / g.target) * 100)}%` }} /></span>
							</button>
							{open === g.id && <GoalCard g={g} canWrite={canWrite} onClose={() => setOpen(null)} />}
						</li>
					)
				})}
			</ul>
			{canWrite && entryScope && (adding ? <NewGoal scope={entryScope} onClose={() => setAdding(false)} /> : (
				<button className={`${BTN} mt-2 uppercase`} onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('money.addGoal')}</button>
			))}
		</section>
	)
}

function GoalCard({ g, canWrite, onClose }: { g: Goal; canWrite: boolean; onClose: () => void }) {
	const { data, api, toast, isSolo } = useTracker()
	const p = data.savings.ledger?.goals[g.id]
	const total = p?.total ?? 0
	const accounts = myLedger(data, todayStr())
	// Со счёта: по умолчанию тот, где уже есть часть, иначе в валюте цели, иначе первый
	const withPart = accounts.find((a) => myPart(data, g.id, a.account.id).amount > 0)
	const [accId, setAccId] = useState((withPart ?? accounts.find((a) => a.account.currency === g.currency) ?? accounts[0])?.account.id ?? '')
	const acc = accounts.find((a) => a.account.id === accId)
	const part = myPart(data, g.id, accId)
	const [val, setVal] = useState('')
	const names: Record<string, string> = { [data.me.id]: t('space.personal'), ...(data.partner && { [data.partner.id]: data.partner.name }), ...data.names }
	const move = async (sign: 1 | -1) => {
		const v = parseAmount(val)
		if (!acc || !v || !(v > 0)) return
		if (sign > 0 && v > acc.free) return toast(t('money.notFree', { x: `${fmt(acc.free)} ${acc.account.currency}` }))
		if (sign < 0 && v > part.amount) return toast(t('money.takeTooMuch', { x: `${fmt(part.amount)} ${acc.account.currency}` }))
		const next = Math.round((part.amount + sign * v) * 100) / 100
		const res = await api<{ alloc: { version: number } }>(`/api/goals/${g.id}/alloc`, 'PUT', { accountId: accId, amount: next, version: part.version, day: todayStr() })
		if (!res) return
		setVal('')
		toast(t(sign > 0 ? 'money.putDone' : 'money.takeDone', { x: `${fmt(v)} ${acc.account.currency}`, g: g.name }), t('money.undo'), () =>
			void api(`/api/goals/${g.id}/alloc`, 'PUT', { accountId: accId, amount: part.amount, version: res.alloc.version, day: todayStr() }))
	}
	const remove = async () => {
		if (total !== 0) return toast(t('money.goalNotEmpty'))
		if (!(await api(`/api/goals/${g.id}?scope=${g.scope}`, 'DELETE'))) return
		onClose()
		toast(t('money.goalRemoved', { x: g.name }), t('money.restore'), () =>
			void api('/api/goals', 'POST', { name: g.name, target: g.target, currency: g.currency, scope: g.scope }))
	}
	return (
		<Panel label={g.name} onClose={onClose}>
			<span className={META}>{t('money.goalTotal', { x: fmt(total), y: fmt(g.target), z: `${fmt(Math.max(0, g.target - total))} ${g.currency}` })}</span>
			{!isSolo && g.scope === 'family' && p && Object.keys(p.byUser).length > 0 && (
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1" aria-label={t('money.byPeople')}>
					{Object.entries(p.byUser).map(([u, v]) => (
						<Fragment key={u}><dt className={META}>{names[u] ?? u}</dt><dd className="text-right">{fmt(v)} {g.currency}</dd></Fragment>
					))}
				</dl>
			)}
			{p && p.missing.length > 0 && <span className="text-warn"><IconText name="warning">{t('money.noRate', { x: p.missing.join(', ') })}</IconText></span>}
			<span className={HINT}>{t('money.goalLedgerHint')}</span>
			{canWrite && accounts.length > 0 && (
				<>
					<div className="flex flex-wrap gap-1.5" role="group" aria-label={t('money.fromAccount')}>
						{accounts.map((a) => {
							const mine = myPart(data, g.id, a.account.id).amount
							return (
								<button key={a.account.id} className="tb" aria-pressed={accId === a.account.id} onClick={() => setAccId(a.account.id)}>
									{termName(a.account.name)}{mine > 0 && <span className="text-muted"> · {fmt(mine)} {a.account.currency}</span>}
								</button>
							)
						})}
					</div>
					{acc && <span className={`${META} ${acc.overdrawn ? 'text-bad' : ''}`}>{t('money.freeOn', { x: `${fmt(acc.free)} ${acc.account.currency}` })}</span>}
					<input className="tfield text-[1.375rem]" inputMode="decimal" ref={focusNoScroll} placeholder={`${t('money.amount')}${acc ? `, ${acc.account.currency}` : ''}`} aria-label={t('money.amount')} value={val}
						onChange={(e) => setVal(amountChars(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && void move(1)} />
					<div className="grid grid-cols-2 gap-1.5">
						<button className={`${PRIMARY} h-12 uppercase`} onClick={() => void move(1)}>{t('money.put')}</button>
						<button className={`${BTN} min-h-12 uppercase`} onClick={() => void move(-1)}>{t('money.giveBack')}</button>
					</div>
				</>
			)}
			{canWrite && total === 0 && (
				<button className="ib self-start text-muted hover:text-bad" onClick={() => void remove()}><IconText name="trash">{t('money.removeGoal')}</IconText></button>
			)}
		</Panel>
	)
}

function NewGoal({ scope, onClose }: { scope: Scope; onClose: () => void }) {
	const { data, api } = useTracker()
	const st = data.settings!
	const [name, setName] = useState('')
	const [target, setTarget] = useState('')
	const [cur, setCur] = useState(st.base)
	const add = async () => {
		const n = name.trim()
		const v = parseAmount(target)
		if (!n || !v || !(v > 0)) return
		if (await api('/api/goals', 'POST', { name: n, target: v, currency: st.currencies.includes(cur) ? cur : st.base, scope })) onClose()
	}
	return (
		<div className="mt-3 flex flex-col gap-3">
			<input ref={focusNoScroll} className="tfield" placeholder={t('money.goalName')} aria-label={t('money.goalName')} value={name} maxLength={40}
				onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
			<div className="flex flex-wrap items-center gap-3">
				<input className="tfield min-w-0 flex-1 text-right" inputMode="decimal" placeholder={t('money.goalTarget')} aria-label={t('money.goalTarget')} value={target}
					onChange={(e) => setTarget(amountChars(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && void add()} />
				<Currencies value={cur} onChange={setCur} />
			</div>
			<div className="flex gap-2">
				<button className={`${BTN} uppercase`} onClick={onClose}>{t('money.cancel')}</button>
				<button className={`${BTN} font-bold uppercase`} onClick={() => void add()}>{t('money.add')}</button>
			</div>
		</div>
	)
}

/** Как менялось: остаток бюджета на конец месяца за полгода. Телефон — строка и шторка, десктоп — сразу список */
function History({ total, open: always = false }: { total: number; open?: boolean }) {
	const { data } = useTracker()
	const { view } = useSpace()
	const [open, setOpen] = useState(false)
	const cur = curMonthKey()
	const keys = Array.from({ length: MONTHS }, (_, i) => shiftMonth(cur, i - MONTHS + 1))
	const series = ledgerHistory(data, view, keys, total)
	const max = Math.max(1, ...series.map((p) => p.value ?? 0))
	const list = (
		<ul className="flex flex-col gap-1.5">
			{series.map((p, i) => {
				const prev = series[i - 1]?.value
				const d = p.value !== null && prev != null ? p.value - prev : null
				return (
					<li key={p.key} className={`grid min-h-8 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2.5 ${p.carried ? 'text-muted' : ''}`}>
						<span className={META}>{abbr(p.key)}</span>
						<span aria-hidden="true" className="flex h-2 bg-line2"><span className={p.carried ? 'bg-muted' : 'bg-ink'} style={{ width: `${Math.max(0, ((p.value ?? 0) / max) * 100)}%` }} /></span>
						<span className="text-right">
							<b className={p.carried ? 'font-normal' : ''}>{p.value === null ? '—' : `${p.carried ? '~' : ''}${fmt(Math.round(p.value))}`}</b>{' '}
							<span className={META}>{d === null || p.carried ? '' : signed(Math.round(d))}</span>
						</span>
					</li>
				)
			})}
		</ul>
	)
	if (always)
		return (
			<section aria-label={t('money.historyTitle')} className="mt-3.5 huge:mt-0">
				<h2 className="sec">{t('money.historyTitle')}</h2>
				<div className="mt-3">{list}</div>
			</section>
		)
	return (
		<>
			<button className={`${ROW} mt-2.5`} onClick={() => setOpen(true)} aria-haspopup="dialog">
				<IconText name="chart">{t('money.history')}</IconText>
				<span className={`flex items-center gap-1.5 ${META}`}>{t('money.historyMonths')}<Icon name="chevron" size={16} /></span>
			</button>
			{open && (
				<Sheet label={t('money.historyTitle')} onClose={() => setOpen(false)}>
					<div className="mb-2 flex items-center justify-between">
						<b className="uppercase">:: {t('money.historyTitle')}</b>
						<button className="ib" onClick={() => setOpen(false)}><Icon name="close" size={20} label={t('action.close')} /></button>
					</div>
					{list}
				</Sheet>
			)}
		</>
	)
}
