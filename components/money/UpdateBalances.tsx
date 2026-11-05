'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTracker } from '../TrackerProvider'
import { useSpace } from '../SpaceProvider'
import { BTN, PRIMARY, Sheet } from '../limits/parts'
import { Icon } from '../icons/Icon'
import { IconText, spaceIcon } from '../icons/IconText'
import { t } from '@/lib/i18n'
import { closeSheet, isSheetOpen, openSheet } from '@/lib/sheet'
import { otherId, unrecordedEntry, verdict } from '@/lib/money'
import type { Account, ReconView } from '@/lib/types'
import { amountChars, ddmm, fmt, incomeSources, liveCats, localDay, numIn, parseAmount, signed, termName, todayStr, uid } from '@/lib/utils'

const PARAM = 'balances'
const H2 = 'text-[1.375rem] leading-tight font-bold outline-none'
const HINT = 'text-[0.8125rem] text-muted2'
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del']

/** Счета, которые пользователь может обновить: семейные и свои личные, не в архиве — как в сверке на сервере */
export function updatable(data: ReturnType<typeof useTracker>['data']): Account[] {
	return [...data.savings.accounts.family, ...data.savings.accounts.mine].filter((a) => !a.archived)
}

/**
 * Проверка и сохранение: dry-запрос к /api/reconcile считает снимок без записи, «Готово» — тот же запрос всерьёз.
 * Разницу можно записать тратой «неучтено» или доходом — после этого проверка пересчитывается
 */
function useCheck(accounts: Account[], onClose: () => void) {
	const { data, api, addEntry, toast } = useTracker()
	const { entryScope } = useSpace()
	const st = data.settings!
	const [result, setResult] = useState<ReconView | null>(null)
	const [busy, setBusy] = useState(false)
	const alive = useRef(true)
	useEffect(() => () => void (alive.current = false), [])
	const body = (balances: Record<string, number>, dry: boolean) => ({
		balances, versions: Object.fromEntries(accounts.map((a) => [a.id, a.version])), day: todayStr(), dry,
	})

	const check = async (balances: Record<string, number>) => {
		setBusy(true)
		const res = await api<{ recon: ReconView }>('/api/reconcile', 'POST', body(balances, true))
		setBusy(false)
		if (res && alive.current) setResult(res.recon)
		return !!res
	}
	// Куда записать разницу: трата — категории выбранного бюджета, доход — источники
	const scope = entryScope ?? 'family'
	const targets = result && result.gap !== null && result.gap < 0 ? incomeSources(st) : liveCats(scope === 'family' ? st.familyCategories : data.mySettings.personalCategories)
	const fix = async (balances: Record<string, number>, to: string | null) => {
		if (!result || result.gap === null || !entryScope) return
		const today = todayStr()
		const fixE = unrecordedEntry(result.gap, { scope, to, base: st.base, today, ddmm: ddmm(today), id: uid(), ts: Date.now() })
		if (!fixE) return
		setBusy(true)
		const err = await addEntry(fixE.kind, fixE.entry)
		setBusy(false)
		if (err) return
		const name = targets.find((c) => c.id === to)?.name
		await check(balances)
		toast(t('money.fixed', { x: fmt(fixE.entry.amount), c: name ?? '' }), t('money.undo'), async () => {
			const q = new URLSearchParams({ kind: fixE.kind, scope: fixE.kind === 'expense' ? scope : 'family', month: today.slice(0, 7) })
			await api(`/api/entries/${encodeURIComponent(fixE.entry.id)}?${q}`, 'DELETE')
			if (alive.current) await check(balances)
		})
	}
	const done = async (balances: Record<string, number>) => {
		setBusy(true)
		const res = await api('/api/reconcile', 'POST', body(balances, false))
		setBusy(false)
		if (!res) return
		toast(t('money.saved'))
		onClose()
	}
	return { result, setResult, busy, check, fix, done, targets }
}

/** Итог «Проверка»: заголовок по результату, фраза с суммой, пример в столбик и кнопки */
function CheckResult({ r, prevDay, busy, head, onFix, onDone, targets }: {
	r: ReconView; prevDay: string | null; busy: boolean; head?: RefObject<HTMLHeadingElement | null>
	onFix: (to: string) => void; onDone: () => void; targets: { id: string; name: string }[]
}) {
	const v = verdict(r)
	// «Прочее» — заранее, если есть; иначе выбрать самому
	const [to, setTo] = useState<string | null>(() => otherId(targets))
	const abs = v.kind === 'first' ? 0 : Math.abs(v.gap)
	const title = { first: t('money.firstTitle'), ok: t('money.okTitle'), missing: t('money.missingTitle'), extra: t('money.extraTitle') }[v.kind]
	const text = v.kind === 'first' ? t('money.firstText') : v.kind === 'ok' ? t('money.okText')
		: t(v.kind === 'missing' ? 'money.missingText' : 'money.extraText', { x: fmt(abs) })
	const off = v.kind === 'missing' || v.kind === 'extra'
	const line = 'border-t pt-1'
	return (
		<>
			<h2 ref={head} tabIndex={-1} className={H2}>{title}</h2>
			<p className={HINT} role="status">{text}</p>
			{v.kind !== 'first' && (
				<div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-1.5">
					<span aria-hidden="true">+</span><span>{t('money.cameSince', { d: prevDay ? ddmm(prevDay) : '—' })}</span><b className="text-right">+{fmt(r.income ?? 0)}</b>
					<span aria-hidden="true">−</span><span>{t('money.spentSince')}</span><b className="text-right">−{fmt(r.expense ?? 0)}</b>
					<span aria-hidden="true" className={`${line} border-line`}>=</span><span className={`${line} border-line`}>{t('money.shouldGrow')}</span><b className={`${line} border-line text-right`}>{signed(r.expected ?? 0)}</b>
					<span /><span>{t('money.didGrow')}</span><b className="text-right">{signed(r.fact ?? 0)}</b>
					<span className={`${line} border-ink`} /><span className={`${line} border-ink`}>{t('money.gap')}</span>
					<b className={`${line} border-ink text-right ${off ? 'text-warn' : ''}`}>{v.kind === 'ok' ? '≈ 0' : `${v.gap > 0 ? '−' : '+'}${fmt(abs)}`}</b>
				</div>
			)}
			<div className="mt-auto flex flex-col gap-2 pt-2">
				{off && targets.length > 0 && (
					<>
						<span className="text-xs text-muted uppercase">{t(v.kind === 'missing' ? 'money.fixWhereExpense' : 'money.fixWhereIncome')}</span>
						<div className="flex flex-wrap gap-1.5" role="group" aria-label={t(v.kind === 'missing' ? 'money.fixWhereExpense' : 'money.fixWhereIncome')}>
							{targets.map((c) => (
								<button key={c.id} className="tb tb-tight max-w-full whitespace-normal break-all" aria-pressed={to === c.id} onClick={() => setTo(c.id)}>{termName(c.name)}</button>
							))}
						</div>
						<button className={`${BTN} min-h-12 whitespace-normal uppercase`} disabled={busy || !to} onClick={() => to && onFix(to)}>
							{t(v.kind === 'missing' ? 'money.fixExpense' : 'money.fixIncome', { x: fmt(abs) })}
						</button>
					</>
				)}
				<button className={PRIMARY} disabled={busy} onClick={onDone}>{t('money.done').toUpperCase()}</button>
			</div>
		</>
	)
}

/** Сумма с пробелами по разрядам, как вводится: «12 345,5» */
const grouped = (s: string) => {
	const [int, frac] = s.split(',')
	return `${fmt(Number(int || '0'))}${frac !== undefined ? `,${frac}` : ''}`
}

/**
 * Телефон: шторка во весь экран, по одному счёту на экран со своей клавиатурой, затем «Проверка».
 * Открытие добавляет ?balances=1 в историю — «назад» закрывает
 */
export function UpdateSheet({ onClose }: { onClose: () => void }) {
	const { data, isSolo } = useTracker()
	const [accounts] = useState(() => updatable(data))
	const [vals, setVals] = useState<Record<string, number>>({})
	const [i, setI] = useState(0)
	const [entry, setEntry] = useState('')
	const c = useCheck(accounts, () => leave())
	const head = useRef<HTMLHeadingElement>(null)
	const prevDay = data.savings.recons.at(-1)?.day ?? null
	const n = accounts.length
	const a = accounts[i]
	useEffect(() => head.current?.focus(), [i, c.result])

	const pushed = useRef(false)
	const done = useRef(onClose)
	done.current = onClose
	useEffect(() => {
		pushed.current ||= openSheet(window, PARAM)
		const onPop = () => !isSheetOpen(window.location.href, PARAM) && done.current()
		window.addEventListener('popstate', onPop)
		return () => window.removeEventListener('popstate', onPop)
	}, [])
	function leave() {
		if (pushed.current) closeSheet(window, true, PARAM)
		else {
			closeSheet(window, false, PARAM)
			onClose()
		}
	}

	const commit = (value: number) => {
		const next = { ...vals, [a.id]: value }
		setVals(next)
		setEntry('')
		if (i + 1 < n) setI(i + 1)
		else void c.check(next).then((ok) => ok && setI(n))
	}
	const press = (k: string) => {
		if (k === 'del') return setEntry(entry.slice(0, -1))
		if (k === ',') return setEntry(entry.includes(',') ? entry : `${entry || '0'},`)
		if (entry.replace(',', '').length >= 12 || /,\d\d$/.test(entry)) return
		setEntry(entry === '0' ? k : entry + k)
	}
	const back = () => {
		if (i === n) c.setResult(null)
		setEntry('')
		setI(i - 1)
	}
	const typed = entry ? parseAmount(entry) : null
	const scopeLabel = !a ? '' : isSolo ? t('money.account') : <IconText name={spaceIcon(a.scope)}>{t(a.scope === 'family' ? 'money.familyAccount' : 'money.myAccount')}</IconText>

	return (
		<Sheet label={t('money.update')} onClose={leave} full>
			<div className="flex items-center justify-between">
				{i > 0 ? <button className="ib" onClick={back}><Icon name="back" size={20} label={t('nav.back')} /></button> : <span className="w-11" />}
				<span className="text-xs text-muted uppercase">{i < n ? t('money.stepOf', { i: i + 1, n }) : t('money.check')}</span>
				<button className="ib" onClick={leave}><Icon name="close" size={20} label={t('action.close')} /></button>
			</div>
			<div className="mt-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-2 [&>*]:shrink-0">
				{i < n && a ? (
					<>
						<span className="text-xs text-muted uppercase">{scopeLabel}</span>
						<h2 ref={head} tabIndex={-1} className={H2}>{t('money.howMuch', { x: a.name.toLowerCase() })}</h2>
						<span className="text-xs text-muted uppercase">{t('money.was', { x: `${fmt(a.balance)} ${a.currency}`, d: ddmm(localDay(a.updatedAt)) })}</span>
						<p className="py-3 text-center" aria-live="polite">
							<b className={`text-[2.75rem] leading-tight ${entry ? '' : 'text-dim'}`}>{entry ? grouped(entry) : fmt(vals[a.id] ?? a.balance)}</b>{' '}
							<span className="text-base text-muted">{a.currency}</span>
						</p>
						<div className="mt-auto grid grid-cols-3 gap-1.5">
							{KEYS.map((k) => (
								<button key={k} className="tbox min-h-[3.25rem] justify-center text-xl" onClick={() => press(k)} aria-label={k === 'del' ? t('entry.erase') : k}>
									{k === 'del' ? <Icon name="backspace" size={20} /> : k}
								</button>
							))}
						</div>
						<div className="grid grid-cols-2 gap-1.5">
							<button className={`${BTN} min-h-[3.25rem] uppercase`} disabled={c.busy} onClick={() => commit(a.balance)}>{t('money.same')}</button>
							<button className={`${PRIMARY} uppercase`} disabled={c.busy || (entry !== '' && typed === null)} onClick={() => commit(typed ?? vals[a.id] ?? a.balance)}>
								{i + 1 < n ? t('money.next') : t('money.toCheck')}
							</button>
						</div>
					</>
				) : c.result && (
					<CheckResult key={c.result.gap ?? 0} r={c.result} prevDay={prevDay} busy={c.busy} head={head} targets={c.targets} onFix={(to) => void c.fix(vals, to)} onDone={() => void c.done(vals)} />
				)}
			</div>
		</Sheet>
	)
}

/** Десктоп: таблица «счёт · было · стало · разница», Tab по полям, проверка под таблицей */
export function UpdateTable({ onClose }: { onClose: () => void }) {
	const { data, isSolo } = useTracker()
	const [accounts] = useState(() => updatable(data))
	const [raw, setRaw] = useState<Record<string, string>>({})
	const c = useCheck(accounts, onClose)
	const first = useRef<HTMLInputElement>(null)
	const prevDay = data.savings.recons.at(-1)?.day ?? null
	useEffect(() => first.current?.focus(), [])
	// Пустое поле — «так же»; неверное число — null
	const value = (a: Account) => (raw[a.id]?.trim() ? parseAmount(raw[a.id]) : a.balance)
	const balances = () => Object.fromEntries(accounts.map((a) => [a.id, value(a) ?? a.balance]))
	const bad = accounts.some((a) => value(a) === null || Number.isNaN(value(a)))

	return (
		<section aria-label={t('money.update')} className="flex flex-col gap-3 border border-ink p-4">
			<div className="flex items-center justify-between">
				<h2 className="sec">{t('money.update')}</h2>
				<button className="ib" onClick={onClose}><Icon name="close" size={20} label={t('action.close')} /></button>
			</div>
			<p className={HINT}>{t('money.tableHint')}</p>
			<table className="w-full uppercase">
				<thead className="text-xs text-muted">
					<tr className="border-b border-line">
						<th className="py-1 text-left font-normal">{t('money.colAccount')}</th>
						<th className="py-1 text-right font-normal">{t('money.colWas')}</th>
						<th className="py-1 text-right font-normal">{t('money.colNow')}</th>
						<th className="py-1 text-right font-normal">{t('money.colDiff')}</th>
					</tr>
				</thead>
				<tbody>
					{accounts.map((a, k) => {
						const v = value(a)
						const d = v === null || Number.isNaN(v) ? null : v - a.balance
						return (
							<tr key={a.id} className="border-b border-dashed border-line2">
								<td className="py-1.5">
									{!isSolo && <Icon name={spaceIcon(a.scope)} size={16} className={`mr-2 ${a.scope === 'personal' ? 'text-muted' : ''}`} label={t(a.scope === 'family' ? 'space.family' : 'space.personal')} />}{a.name}
								</td>
								<td className="py-1.5 text-right text-muted">{fmt(a.balance)} {a.currency}</td>
								<td className="py-1.5 text-right">
									<input ref={k === 0 ? first : undefined} className="tfield w-[14ch] text-right" inputMode="decimal" aria-label={`${t('money.colNow')}, ${a.name}`}
										placeholder={numIn(a.balance)} value={raw[a.id] ?? ''}
										onChange={(e) => { setRaw((r) => ({ ...r, [a.id]: amountChars(e.target.value) })); c.setResult(null) }}
										onKeyDown={(e) => e.key === 'Enter' && !bad && void c.check(balances())} />
								</td>
								<td className={`py-1.5 text-right ${d ? '' : 'text-muted'}`}>{d === null ? '?' : d === 0 ? '0' : signed(d)}</td>
							</tr>
						)
					})}
				</tbody>
			</table>
			{!c.result ? (
				<button className={`${BTN} self-start font-bold uppercase`} disabled={bad || c.busy} onClick={() => void c.check(balances())}>{t('money.toCheck')}</button>
			) : (
				<div className="flex flex-col gap-3 border-t border-dashed border-line pt-3">
					<CheckResult key={c.result.gap ?? 0} r={c.result} prevDay={prevDay} busy={c.busy} targets={c.targets} onFix={(to) => void c.fix(balances(), to)} onDone={() => void c.done(balances())} />
				</div>
			)}
		</section>
	)
}
