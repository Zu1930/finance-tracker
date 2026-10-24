'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { OnceReveal } from '../settings/Kit'
import { amountChars, fmt, parseAmount } from '@/lib/utils'
import {
	CURRENCIES, PAY_PRESETS, accountPresets, catPresetsFor, chosenCats, localeCurrency, payCategory, presetIn, ratesFor, readDraft, toDraft, writeDraft,
	type WelcomeDraft, type WelcomeLocal, type WelcomeStep,
} from '@/lib/onboarding'
import type { Scope } from '@/lib/types'

type Step = WelcomeStep
type Local = WelcomeLocal
const FULL: Step[] = ['intro', 'currency', 'who', 'cats', 'payments', 'accounts', 'done']
// Приглашённый: валюта и «для кого» уже решены семьёй; вместо них — экран «Вы в семейном бюджете»
const SHORT: Step[] = ['intro', 'family', 'cats', 'payments', 'accounts', 'done']

type Info = { status: 'pending' | 'done' | 'skipped'; invited: boolean; base: string | null; name: string; rsdPer: Record<string, number> }

// Черновик ответов в localStorage: перезагрузка ничего не теряет
const load = (userId: string) => (typeof localStorage === 'undefined' ? null : readDraft(localStorage, userId))
const save = (d: Local) => writeDraft(localStorage, d)
const clear = () => writeDraft(localStorage, null)

/** Событие шага — без ожидания: опрос не ждёт аналитику */
const track = (step: string, action: 'view' | 'next' | 'skip' | 'back' | 'finish') =>
	void fetch('/api/onboarding/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step, action }), keepalive: true }).catch(() => {})

/** Шкала прогресса из 8 ячеек: [████░░░░] 2/5 */
const bar = (n: number, of: number) => {
	const full = Math.round((n / of) * 8)
	return `[${'█'.repeat(full)}${'░'.repeat(8 - full)}] ${n}/${of}`
}

/** Опрос-настройка после подтверждения email: пять вопросов, любой можно пропустить, всё создаётся в конце одним запросом */
export function Welcome({ userId }: { userId: string }) {
	const [info, setInfo] = useState<Info | null>(null)
	const [d, setD] = useState<Local | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [invite, setInvite] = useState<{ code: string; until: string } | null>(null)
	const [result, setResult] = useState<WelcomeDraft | null>(null)

	useEffect(() => {
		fetch('/api/onboarding', { cache: 'no-store' })
			.then((r) => (r.status === 401 ? (window.location.href = '/login', null) : r.json()))
			.then((j: Info | null) => {
				if (!j) return
				// Опрос пройден или пропущен — сюда больше не нужно
				if (j.status !== 'pending') return void window.location.replace('/')
				setInfo(j)
				const cur = j.base ?? localeCurrency(navigator.language)
				const presets = catPresetsFor(j.invited)
				setD(
					load(userId) ?? {
						userId, step: 0, currency: CURRENCIES.includes(cur as never) ? cur : 'USD', who: 'solo',
						picked: Object.fromEntries(presets.filter((p) => p.on).map((p) => [p.key, p.family && !j.invited ? 'family' : 'personal'])),
						custom: [], pays: {}, accounts: {}, skipped: [],
					},
				)
			})
			.catch(() => setError('Сервер недоступен, обновите страницу'))
	}, [userId])

	const steps = info?.invited ? SHORT : FULL
	const step = d ? steps[Math.min(d.step, steps.length - 1)] : 'intro'
	useEffect(() => {
		if (d) track(step, 'view')
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [step, !!d])

	if (!info || !d) return <Frame>{error ? <p className="text-bad uppercase">!! {error}</p> : <p className="text-muted">&gt; ЗАГРУЗКА…</p>}</Frame>

	const invited = info.invited
	const base = info.base ?? d.currency
	const pair = !invited && d.who === 'pair'
	const update = (patch: Partial<Local>) => {
		const next = { ...d, ...patch }
		setD(next)
		save(next)
	}
	const questions: Step[] = steps.filter((s) => s !== 'intro' && s !== 'done' && s !== 'family')
	const qIndex = questions.indexOf(step) + 1

	const presets = catPresetsFor(invited)
	const limitOf = (rsd: number) => presetIn(rsd, base, info.rsdPer)
	const catsChosen = chosenCats(d, invited)
	const draft = (skipped = d.skipped): WelcomeDraft => toDraft(d, invited, skipped)

	const finish = async (skipped: Step[]) => {
		setBusy(true)
		setError('')
		const body = draft(skipped)
		const res = await fetch('/api/onboarding/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
		const j = (await res?.json().catch(() => null)) as { inviteCode?: string | null; inviteUntil?: string | null; error?: string } | null
		setBusy(false)
		if (!res?.ok) return setError(j?.error ?? 'Не удалось сохранить, повторите')
		track('accounts', 'finish')
		clear()
		setResult(body)
		if (j?.inviteCode && j.inviteUntil) setInvite({ code: j.inviteCode, until: j.inviteUntil })
		setD((cur) => cur && { ...cur, step: steps.indexOf('done') })
	}
	const go = (delta: 1 | -1, skip = false) => {
		track(step, skip ? 'skip' : delta > 0 ? 'next' : 'back')
		const skipped = delta < 0 ? d.skipped : skip ? [...new Set([...d.skipped, step])] : d.skipped.filter((s) => s !== step)
		if (delta > 0 && step === 'accounts') {
			update({ skipped })
			return void finish(skipped)
		}
		update({ step: Math.max(0, d.step + delta), skipped })
	}
	const selfSetup = async () => {
		track('intro', 'skip')
		setBusy(true)
		const res = await fetch('/api/onboarding/skip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currency: d.currency }) }).catch(() => null)
		if (!res?.ok && res?.status !== 409) {
			setBusy(false)
			return setError('Не удалось сохранить, повторите')
		}
		clear()
		window.location.href = '/'
	}

	if (step === 'intro')
		return (
			<Frame>
				<h1 className="text-xl font-bold">{invited ? `Добро пожаловать в семейный бюджет` : 'Настроим бюджет за минуту?'}</h1>
				<p className="mt-3 text-muted">
					{invited ? 'Три коротких вопроса о ваших личных тратах — остальное уже настроено.' : 'Пять коротких вопросов — валюта, для кого, категории, обязательные платежи и счета. Любой можно пропустить.'}
				</p>
				<div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
					<button className="tb h-12 font-bold max-sm:w-full sm:px-6" onClick={() => go(1)}>Начать</button>
					<button className="min-h-12 text-muted uppercase underline-offset-4 hover:underline max-sm:w-full" disabled={busy} onClick={() => void selfSetup()}>Настрою сам</button>
				</div>
				<Err text={error} />
			</Frame>
		)

	if (step === 'done') {
		const r = result ?? draft()
		const cats = r.cats ?? []
		const pays = r.payments ?? []
		const accs = r.accounts ?? []
		const rate = ratesFor(base, ['EUR'], info.rsdPer).EUR ?? 1
		const accTotal = accs.reduce((a, x) => a + (accountPresets(base).find((p) => p.key === x.key)?.currency === 'EUR' ? x.balance * rate : x.balance), 0)
		return (
			<Frame>
				<h1 className="sec">Готово</h1>
				<dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 uppercase">
					<dt className="text-muted">Категории</dt>
					<dd>{r.cats ? `${cats.length} · ${fmt(cats.reduce((a, c) => a + (presets.find((p) => p.key === c.key) ? limitOf(presets.find((p) => p.key === c.key)!.rsd) : 0), 0) + pays.reduce((a, p) => a + p.amount, 0))} ${base} в месяц` : 'по умолчанию'}</dd>
					<dt className="text-muted">Обязательные</dt>
					<dd>{pays.length ? `${pays.length} · ${fmt(pays.reduce((a, p) => a + p.amount, 0))} ${base} в месяц · в лимитах` : 'нет'}</dd>
					<dt className="text-muted">Счета</dt>
					<dd>{accs.length ? `${accs.length} · ≈ ${fmt(Math.round(accTotal))} ${base}` : 'нет'}</dd>
				</dl>
				{invite && (
					<>
						<p className="mt-6 uppercase">Ссылка для партнёра</p>
						<OnceReveal value={`${window.location.origin}/join/${invite.code}`} until={invite.until}
							note="Отправьте партнёру. Новую ссылку можно сделать в настройках → Семья." onHide={() => setInvite(null)} />
					</>
				)}
				<p className="mt-6 text-muted">Осталось записать первую трату. Остальное — в карточке «Настройка» на главном экране, её можно скрыть.</p>
				<Link href="/?focus=amount" className="tb mt-6 h-12 font-bold max-sm:w-full sm:px-6">Записать первую трату</Link>
			</Frame>
		)
	}

	let body: ReactNode
	let footer: ReactNode = null
	if (step === 'family')
		body = (
			<>
				<h1 className="text-lg font-bold">Вы в семейном бюджете</h1>
				<p className="mt-3 text-muted">Ваши траты, счета и категории станут личными. Новые семейные траты увидят оба участника.</p>
				<p className="mt-3 text-muted2">Валюта бюджета — {base}. Дальше — ваши личные категории, платежи и счета.</p>
			</>
		)
	else if (step === 'currency')
		body = (
			<>
				<h1 className="text-lg font-bold">Основная валюта</h1>
				<div className="mt-5 grid grid-cols-4 gap-2 sm:flex" role="group" aria-label="Основная валюта">
					{CURRENCIES.map((c) => (
						<button key={c} className="tb mbare h-12 sm:px-5" aria-pressed={d.currency === c} onClick={() => update({ currency: c })}>{c}</button>
					))}
				</div>
				<p className="mt-3 text-muted2">В ней будут лимиты и итоги. Тратить можно в любой валюте.</p>
			</>
		)
	else if (step === 'who')
		body = (
			<>
				<h1 className="text-lg font-bold">Для кого бюджет</h1>
				<div className="mt-5 grid gap-3 sm:grid-cols-2" role="group" aria-label="Для кого бюджет">
					{([['solo', 'Только я', 'все траты в одном месте'], ['pair', 'С партнёром', 'общие траты + личные у каждого']] as const).map(([v, t, s]) => (
						<button key={v} aria-pressed={d.who === v} onClick={() => update({ who: v })}
							className="tbox min-h-24 flex-col items-start justify-center gap-1 px-4 py-3 text-left normal-case aria-pressed:[&_span]:text-panel">
							<b className="uppercase">{t}</b>
							<span className="font-normal text-muted">— {s}</span>
						</button>
					))}
				</div>
				{d.who === 'pair' && <p className="mt-3 text-muted2">Пригласить партнёра предложим в конце. Ваши личные траты он не увидит.</p>}
			</>
		)
	else if (step === 'cats') {
		const total = catsChosen.reduce((a, c) => a + (c.key ? limitOf(presets.find((p) => p.key === c.key)!.rsd) : 0), 0)
		body = (
			<>
				<h1 className="text-lg font-bold">{invited ? 'Ваши личные категории' : 'Категории и лимиты'}</h1>
				<p className="mt-2 text-muted2">
					{pair ? 'Лимиты примерные, поправите потом. Долгое нажатие или правый клик — семейная или личная.' : 'Лимиты примерные — поправите потом на странице «Лимиты».'}
				</p>
				<div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Категории">
					{presets.map((p) => (
						<CatTile key={p.key} name={p.name} limit={`${fmt(limitOf(p.rsd))}`} on={!!d.picked[p.key]} scope={pair ? (d.picked[p.key] ?? (p.family ? 'family' : 'personal')) : null}
							toggle={() => {
								const picked = { ...d.picked }
								if (picked[p.key]) delete picked[p.key]
								else picked[p.key] = p.family && !invited ? 'family' : 'personal'
								update({ picked })
							}}
							flip={() => update({ picked: { ...d.picked, [p.key]: d.picked[p.key] === 'family' ? 'personal' : 'family' } })} />
					))}
					{d.custom.map((c, i) => (
						<CatTile key={`c-${c.name}`} name={c.name} limit="0" on scope={pair ? c.scope : null}
							toggle={() => update({ custom: d.custom.filter((_, j) => j !== i) })}
							flip={() => update({ custom: d.custom.map((x, j) => (j === i ? { ...x, scope: x.scope === 'family' ? 'personal' : 'family' } : x)) })} />
					))}
				</div>
				<CustomCat onAdd={(name) => {
					const taken = [...presets.map((p) => p.name), ...d.custom.map((c) => c.name)].some((n) => n.toLowerCase() === name.toLowerCase())
					if (!taken) update({ custom: [...d.custom, { name, scope: pair && !invited ? 'family' : 'personal' }] })
				}} />
				<p className="mt-4 uppercase">Выбрано {catsChosen.length} · лимиты на {fmt(total)} {base} в месяц</p>
			</>
		)
	} else if (step === 'payments') {
		const chosen = catsChosen.flatMap((c) => (c.key ? [c.key] : []))
		const total = Object.values(d.pays).reduce((a, p) => a + (parseAmount(p.amount) ?? 0), 0)
		body = (
			<>
				<h1 className="text-lg font-bold">Обязательные платежи</h1>
				<p className="mt-2 text-muted2">Сумма добавится к лимиту категории, а в день оплаты платёж появится на вводе — отметите одним нажатием.</p>
				<ul className="mt-4">
					{PAY_PRESETS.map((p) => {
						const on = d.pays[p.key]
						const cat = catsChosen.find((c) => c.key === payCategory(p, chosen))
						return (
							<li key={p.key} className="border-b border-dashed border-line2 py-1">
								<button className="flex min-h-12 w-full items-center gap-3 text-left uppercase" aria-pressed={!!on}
									onClick={() => {
										const pays = { ...d.pays }
										if (on) delete pays[p.key]
										else pays[p.key] = { amount: String(limitOf(p.rsd)).replace('.', ','), day: String(p.day) }
										update({ pays })
									}}>
									<span aria-hidden="true">[{on ? '■' : ' '}]</span>
									<span className={on ? 'font-bold' : ''}>{p.name}</span>
									{p.approx && <span className="text-xs text-muted normal-case">// сумма меняется</span>}
									<span className="ml-auto text-xs text-muted">{cat ? cat.name : 'Прочее'}{pair && cat ? ` · ${cat.scope === 'family' ? 'сем' : 'личн'}` : ''}</span>
								</button>
								{on && (
									<div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-2 pl-8">
										<label className="lbl" htmlFor={`pay-${p.key}`}>Сумма</label>
										{p.approx && <span aria-hidden="true">≈</span>}
										<input id={`pay-${p.key}`} className="tfield w-[12ch]" inputMode="decimal" autoComplete="off" value={on.amount}
											onChange={(e) => update({ pays: { ...d.pays, [p.key]: { ...on, amount: amountChars(e.target.value) } } })} />
										<span className="text-muted">{base}</span>
										<label className="lbl sm:ml-3" htmlFor={`day-${p.key}`}>День</label>
										<input id={`day-${p.key}`} className="tfield w-[5ch]" inputMode="numeric" autoComplete="off" value={on.day}
											onChange={(e) => update({ pays: { ...d.pays, [p.key]: { ...on, day: e.target.value.replace(/\D/g, '').slice(0, 2) } } })} />
									</div>
								)}
							</li>
						)
					})}
				</ul>
				<p className="mt-4 uppercase">Обязательные: {fmt(total)} {base} в месяц</p>
			</>
		)
	} else {
		const rate = ratesFor(base, ['EUR'], info.rsdPer).EUR ?? 1
		const list = accountPresets(base)
		const total = list.reduce((a, p) => {
			const v = d.accounts[p.key]?.trim() ? parseAmount(d.accounts[p.key]) ?? 0 : 0
			return a + (p.currency === 'EUR' ? v * rate : v)
		}, 0)
		body = (
			<>
				<h1 className="text-lg font-bold">Где лежат деньги</h1>
				<p className="mt-2 text-muted2">Остатки сейчас — точка отсчёта. Потом раз в одну-две недели обновите, и станет видно забытые траты.</p>
				<ul className="mt-4">
					{list.map((p) => (
						<li key={p.key} className="flex min-h-12 flex-wrap items-center gap-x-3 border-b border-dashed border-line2 py-1">
							<label htmlFor={`acc-${p.key}`} className="min-w-[14ch] flex-1 uppercase">{p.name}</label>
							<input id={`acc-${p.key}`} className="tfield w-[14ch] text-right" inputMode="decimal" autoComplete="off" placeholder="остаток"
								value={d.accounts[p.key] ?? ''} onChange={(e) => update({ accounts: { ...d.accounts, [p.key]: amountChars(e.target.value) } })} />
							<span className="w-[4ch] text-muted">{p.currency ?? base}</span>
						</li>
					))}
				</ul>
				<p className="mt-4 uppercase">Всего ≈ {fmt(Math.round(total))} {base} · пустые строки не создадутся</p>
			</>
		)
	}

	footer = (
		<div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-dashed border-line pt-4 uppercase max-sm:grid max-sm:grid-cols-2">
			<button className="tb h-12 sm:h-auto sm:min-h-11" onClick={() => go(-1)} disabled={busy}>‹ Назад</button>
			{step !== 'family' && (
				<button className="min-h-12 text-muted underline-offset-4 hover:underline sm:min-h-11" onClick={() => go(1, true)} disabled={busy}>Пропустить</button>
			)}
			<button className="tb h-12 font-bold max-sm:col-span-2 sm:ml-auto sm:h-auto sm:min-h-11 sm:px-4" onClick={() => go(1)} disabled={busy}>
				{busy ? 'Сохраняю…' : step === 'accounts' ? 'Готово ›' : 'Дальше ›'}
			</button>
		</div>
	)

	return (
		<Frame progress={qIndex > 0 ? bar(qIndex, questions.length) : undefined}>
			{body}
			<Err text={error} />
			{footer}
		</Frame>
	)
}

function Frame({ children, progress }: { children: ReactNode; progress?: string }) {
	return (
		<div className="px-4 pb-10">
			<main className="mx-auto mt-6 max-w-[680px] sm:mt-[8vh]">
				<header className="mb-6 flex items-baseline justify-between gap-4">
					<b className="lowercase">&gt; spend.log</b>
					{progress && <span className="text-muted" aria-label={`Вопрос ${progress.split(' ')[1]}`}>{progress}</span>}
				</header>
				{children}
			</main>
		</div>
	)
}

const Err = ({ text }: { text: string }) => <p className="mt-3 min-h-5 text-bad uppercase" role="alert">{text && `!! ${text}`}</p>

/** Плашка категории: выбранная инвертирована с ■; у пары — метка СЕМ/ЛИЧН, долгое нажатие или правый клик её меняют */
function CatTile({ name, limit, on, scope, toggle, flip }: { name: string; limit: string; on: boolean; scope: Scope | null; toggle: () => void; flip: () => void }) {
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const flipped = useRef(false)
	const cancel = () => {
		if (timer.current) clearTimeout(timer.current)
		timer.current = null
	}
	return (
		<button
			className="tbox min-h-12 flex-col items-stretch justify-center gap-0.5 px-3 py-2 text-left select-none [-webkit-touch-callout:none] sm:flex-row sm:items-center sm:justify-between sm:gap-2"
			aria-pressed={on}
			onClick={() => {
				if (flipped.current) return void (flipped.current = false)
				toggle()
			}}
			onContextMenu={(e) => {
				if (scope === null) return
				e.preventDefault()
				flip()
			}}
			onPointerDown={() => {
				if (scope === null) return
				flipped.current = false
				timer.current = setTimeout(() => {
					flipped.current = true
					flip()
				}, 500)
			}}
			onPointerUp={cancel}
			onPointerLeave={cancel}
		>
			{/* Мобильный: название целиком, лимит и метка — второй строкой */}
			<span className="min-w-0 truncate">
				{on && <span aria-hidden="true">■ </span>}
				{name}
			</span>
			<span className="flex shrink-0 items-baseline justify-between gap-2 font-normal opacity-70">
				{scope && <span className="text-[11px]">{scope === 'family' ? 'СЕМ' : 'ЛИЧН'}</span>}
				<span className="ml-auto">{limit}</span>
			</span>
		</button>
	)
}

function CustomCat({ onAdd }: { onAdd: (name: string) => void }) {
	const [v, setV] = useState('')
	const add = () => {
		const name = v.trim().slice(0, 40)
		if (!name) return
		onAdd(name)
		setV('')
	}
	return (
		<div className="mt-3 flex items-center gap-3">
			<label htmlFor="own-cat" className="sr-only">Своя категория</label>
			<input id="own-cat" className="tfield flex-1" placeholder="своя категория" maxLength={40} value={v}
				onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
			<button className="tb h-12 sm:h-auto sm:min-h-11" disabled={!v.trim()} onClick={add}>Добавить</button>
		</div>
	)
}
