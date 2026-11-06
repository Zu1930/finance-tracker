'use client'

import { Fragment, useEffect, useRef, useState, type RefObject } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTracker } from '../TrackerProvider'
import { useSpace } from '../SpaceProvider'
import { dateLabel, type EntryMode } from './EntryForm'
import type { ParsedEntry } from '@/lib/quick-entry/parse'
import { useEntryDraft } from './useEntryDraft'
import { PlanChips } from './EntryPage'
import { scopeReasonText, useQuickEntry } from './QuickEntry'
import { entryProblem } from '@/lib/quick-entry/entry'
import { BACKSPACE, KEYS, evalExpr, hasOp, press, toAmount, type Key } from '@/lib/keypad'
import { Icon } from '../icons/Icon'
import { IconText, Problem, spaceIcon } from '../icons/IconText'
import { t } from '@/lib/i18n'
import { SHEET_PARAM, closeSheet, openSheet } from '@/lib/sheet'
import { Portal, useInertApp, useScrollLock, useSheetLayout } from '../useSheet'
import { SPACE, incomeAllowed, incomeSwitch, type FeedRow } from '@/lib/space'
import type { Expense, Income, Scope } from '@/lib/types'
import { amountChars, fmt, numIn, termName } from '@/lib/utils'

// ---------- Способ ввода ----------
export type EntryMethod = 'keys' | 'voice'
/** Последний способ ввода в форме */
const LAST_KEY = 'ft:entry-mode'
/** Настройка «Ввод на телефоне»: last — последний способ */
export const PREF_KEY = 'ft:entry-pref'
export type EntryPref = 'last' | EntryMethod
const get = (k: string) => {
	try {
		return localStorage.getItem(k)
	} catch {
		return null
	}
}
const set = (k: string, v: string) => {
	try {
		localStorage.setItem(k, v)
	} catch {}
}
export const readPref = (): EntryPref => {
	const v = get(PREF_KEY)
	return v === 'keys' || v === 'voice' ? v : 'last'
}
export const writePref = (p: EntryPref) => set(PREF_KEY, p)
const startMethod = (): EntryMethod => {
	const p = readPref()
	return p !== 'last' ? p : get(LAST_KEY) === 'voice' ? 'voice' : 'keys'
}

// ---------- Открытие формы ----------
type Request = { copy?: FeedRow; voice?: boolean; listen?: boolean }
/** Что открыть: задаёт вызывающий (лента, кнопка «+»), читает форма при открытии */
let pending: Request = {}
/** Запись ?new=1 добавлена нами — закрывать шагом назад */
let pushed = false

/** Открыть форму поверх текущей страницы: запись в истории ?new=1 */
export function requestEntry(r: Request) {
	pending = r
	pushed = openSheet(window) || pushed
}
function finish() {
	pending = {}
	closeSheet(window, pushed)
	pushed = false
}

/** Действие кнопки «+»: в «всё вместе» — выбор бюджета */
export const fabAction = (readOnly: boolean, hold: boolean) => (readOnly ? 'chooser' : hold ? 'voice' : 'entry')

/**
 * Кнопка «+» в нижней панели и форма поверх страницы. Нажатие — последний способ ввода, удержание 500 мс — голос
 * с начатой записью. Открыта форма или нет — по ?new=1 в адресе, поэтому «назад» её закрывает
 */
export function EntrySheetHost() {
	const params = useSearchParams()
	const { readOnly, entryScope, setChooserOpen } = useSpace()
	const open = params.get(SHEET_PARAM) === '1'
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const held = useRef(false)

	const act = (hold: boolean) => {
		const a = fabAction(readOnly, hold)
		if (a === 'chooser') return setChooserOpen(true)
		requestEntry(a === 'voice' ? { voice: true, listen: true } : {})
	}
	const down = () => {
		held.current = false
		clearTimeout(timer.current)
		timer.current = setTimeout(() => {
			held.current = true
			navigator.vibrate?.(10)
			act(true)
		}, 500)
	}
	const up = () => clearTimeout(timer.current)

	// Открыто в «всё вместе» (перезагрузка с ?new=1) — писать некуда, убрать из адреса
	useEffect(() => {
		if (open && !entryScope) finish()
	}, [open, entryScope])

	return (
		<>
			<span className="flex justify-center">
				<button
					className="-mt-[1.625rem] flex h-16 w-16 items-center justify-center border border-ink bg-ink text-panel select-none [-webkit-touch-callout:none]"
					style={{ opacity: readOnly ? 0.45 : 1 }}
					onPointerDown={down}
					onPointerUp={up}
					onPointerLeave={up}
					onPointerCancel={up}
					onContextMenu={(e) => e.preventDefault()}
					onClick={() => {
						if (held.current) return void (held.current = false)
						act(false)
					}}
				>
					<Icon name="plus" size={24} label={readOnly ? t('space.pickToWrite') : t('entry.new')} />
				</button>
			</span>
			{open && entryScope && <MobileEntry req={pending} scope0={entryScope} onClose={finish} />}
		</>
	)
}

// ---------- Форма ----------
const chip = 'tbox min-h-11 shrink-0 justify-center px-3'

function MobileEntry({ req, scope0, onClose }: { req: Request; scope0: Scope; onClose: () => void }) {
	const { isSolo } = useTracker()
	const copy = req.copy
	// Доход всегда личный
	const [scope, setScope] = useState<Scope>(copy?.kind === 'expense' ? copy.e.scope : copy?.kind === 'income' && !isSolo ? 'personal' : scope0)
	const [kind, setKind] = useState<EntryMode>(copy?.kind === 'income' ? 'income' : 'expense')
	const [method, setMethodState] = useState<EntryMethod>(() => (req.voice ? 'voice' : copy ? 'keys' : startMethod()))
	const setMethod = (m: EntryMethod) => {
		setMethodState(m)
		set(LAST_KEY, m)
	}
	const d = useEntryDraft(scope, kind)
	const { form } = d
	const [expr, setExprState] = useState('')
	const setExpr = (e: string) => {
		setExprState(e)
		form.setAmount(toAmount(e))
	}
	const incomeOk = incomeAllowed(scope, isSolo)
	// Доход начат в «Семье» («+» на пустой сумме или голосом) — бюджет переключён на личный, под чипами — почему
	const [incomeNote, setIncomeNote] = useState(false)
	const toIncome = () => {
		const sw = incomeSwitch(scope, isSolo)
		if (sw.note) {
			setScope(sw.scope)
			setIncomeNote(true)
		}
		setKind('income')
		form.setError('')
	}
	const boxRef = useRef<HTMLDivElement>(null)

	// «В форму» из ленты: те же сумма, валюта, заметка, дата и категория
	useEffect(() => {
		if (!copy) return
		const e = copy.e
		form.fill({ amount: numIn(e.amount), currency: e.currency, note: e.note, date: e.date }, false)
		setExprState(numIn(e.amount))
		if (copy.kind === 'expense') d.setCatId((e as Expense).catId)
		else d.setSrcId((e as Income).sourceId)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// Закрытие с анимацией: шторка уезжает вниз, затем запись ?new=1 уходит из истории
	const [leaving, setLeaving] = useState(false)
	const close = () => {
		if (leaving) return
		setLeaving(true)
		setTimeout(onClose, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220)
	}
	const closeRef = useRef(close)
	closeRef.current = close
	// Смахнуть вниз за верх шторки: дальше 120px или быстрым жестом — закрыть, иначе вернуть на место
	const [dy, setDy] = useState(0)
	const drag = useRef<{ y: number; t: number } | null>(null)
	const onDown = (e: React.PointerEvent) => {
		if ((e.target as HTMLElement).closest('button')) return
		drag.current = { y: e.clientY, t: Date.now() }
		e.currentTarget.setPointerCapture(e.pointerId)
	}
	const onMove = (e: React.PointerEvent) => {
		if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y))
	}
	const onUp = () => {
		if (!drag.current) return
		const speed = dy / Math.max(1, Date.now() - drag.current.t)
		drag.current = null
		if (dy > 120 || speed > 0.6) close()
		else setDy(0)
	}

	// Фокус внутри формы, Tab не уходит наружу, Esc закрывает
	useEffect(() => {
		const box = boxRef.current!
		box.querySelector<HTMLElement>('[data-autofocus]')?.focus()
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') return closeRef.current()
			if (e.key !== 'Tab') return
			const list = [...box.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')].filter((x) => x.offsetParent !== null)
			const [first, last] = [list[0], list.at(-1)]
			if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last?.focus())
			else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first?.focus())
		}
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('keydown', onKey)
		}
	}, [])

	const save = () => {
		if (d.submit()) close()
	}
	const dragging = drag.current !== null

	// Страница под шторкой не прокручивается и не получает касаний; раскладка — из измерений (useSheetLayout)
	useScrollLock(true)
	useInertApp(true)
	const midRef = useRef<HTMLDivElement>(null)
	useSheetLayout(boxRef, midRef)

	return (
		<Portal>
			<div
				aria-hidden="true"
				className="fixed inset-0 z-40 [touch-action:none] motion-safe:animate-[fade-in_.25s_ease-out]"
				style={{ background: 'rgba(0,0,0,.35)', opacity: leaving ? 0 : Math.max(0.2, 1 - dy / 400), transition: dragging ? 'none' : 'opacity .22s ease' }}
				onClick={close}
			/>
			<div
				ref={boxRef}
				role="dialog"
				aria-modal="true"
				aria-label={t('entry.new')}
				data-entry-sheet
				// Высота по содержимому, не выше --avail; прижата к низу видимой области (переменные ставит useSheetLayout)
				className="fixed inset-x-0 bottom-[var(--sheet-bottom,0px)] z-40 flex h-auto max-h-[var(--avail,calc(100dvh-1rem))] flex-col border-t border-ink bg-panel px-4 text-sm motion-safe:animate-[sheet-up_.2s_cubic-bezier(.2,.8,.2,1)]"
				style={{
					transform: leaving ? 'translateY(100%)' : dy ? `translateY(${dy}px)` : undefined,
					transition: dragging ? 'none' : 'transform .22s cubic-bezier(.4,0,1,1)',
				}}
			>
				{/* Ручка и строка с кнопками — за них шторку можно смахнуть вниз */}
				<div className="-mx-4 flex shrink-0 cursor-grab flex-col gap-2 px-4 pt-2 pb-2.5 [touch-action:none]" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
				<span aria-hidden="true" className="mx-auto block h-1 w-10 bg-line" />
				<div className="flex items-center justify-between gap-2">
					<div role="group" aria-label="Тип записи" className="flex">
						<button className={`${chip} px-2`} aria-pressed={kind === 'expense'} onClick={() => { setKind('expense'); setIncomeNote(false) }}><IconText name="expense">{t('entry.expense')}</IconText></button>
						{incomeOk && <button className={`${chip} -ml-px px-2`} aria-pressed={kind === 'income'} onClick={() => setKind('income')}><IconText name="income">{t('entry.income')}</IconText></button>}
					</div>
					<span className="flex items-center gap-1">
						<span role="group" aria-label={t('entry.method')} className="flex">
							<button className={`${chip} px-2.5`} aria-pressed={method === 'keys'} onClick={() => setMethod('keys')}><Icon name="keypad" size={20} label={t('entry.keys')} /></button>
							<button className={`${chip} -ml-px px-2.5`} aria-pressed={method === 'voice'} onClick={() => setMethod('voice')}><Icon name="mic" size={20} label={t('entry.voice')} /></button>
						</span>
						<button className="ib text-ink" onClick={close}><Icon name="close" size={20} label={t('action.close')} /></button>
					</span>
				</div>
				</div>
				{method === 'keys' || kind === 'income' ? (
					<Keys midRef={midRef} d={d} kind={kind} scope={scope} expr={expr} setExpr={setExpr} onSave={save} onPlus={toIncome} incomeNote={incomeNote}
						toggleScope={isSolo || kind === 'income' ? null : () => setScope(scope === 'family' ? 'personal' : 'family')} />
				) : (
					<Voice midRef={midRef} d={d} scope={scope} listen={!!req.listen} onClose={close}
						onEdit={(p, amount) => {
							if (p.kind === 'income') toIncome()
							else setScope(p.scope)
							setExprState(amount)
							setMethod('keys')
						}} />
				)}
			</div>
		</Portal>
	)
}

// ---------- Клавиши ----------
function Keys({ midRef, d, kind, scope, expr, setExpr, toggleScope, onSave, onPlus, incomeNote }: {
	midRef: RefObject<HTMLDivElement | null>
	d: ReturnType<typeof useEntryDraft>; kind: EntryMode; scope: Scope; expr: string; setExpr: (e: string) => void
	/** null — бюджет не переключается (solo, доход — всегда личный) */
	toggleScope: (() => void) | null
	onSave: () => void
	/** «+» на пустой сумме траты — это доход */
	onPlus: () => void
	incomeNote: boolean
}) {
	const { isSolo } = useTracker()
	const { form } = d
	const st = form.st
	const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const options = kind === 'expense' ? d.cats : d.sources
	const selected = kind === 'expense' ? d.catId : d.src.id
	const value = evalExpr(expr)

	const tap = (k: Key) => {
		if (k === '+' && !expr && kind === 'expense') return onPlus()
		setExpr(press(expr, k))
		form.setError('')
	}

	// Enter на внешней клавиатуре — запись
	const saveRef = useRef(onSave)
	saveRef.current = onSave
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Enter' || e.isComposing) return
			e.preventDefault()
			saveRef.current()
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [])
	const [curOpen, setCurOpen] = useState(false)
	// Фокус в заметке или курсе — открыта системная клавиатура: свои клавиши прячутся, «Записать» остаётся.
	// Снятие фокуса — с задержкой, чтобы нажатие на «Записать» попало в ту же кнопку
	const [typing, setTyping] = useState(false)
	const isText = (el: Element | null) => el instanceof HTMLInputElement && !el.readOnly && el.type !== 'date'
	const saveKey = 'tbox justify-center gap-1 border-ink bg-ink font-bold text-panel uppercase hover:bg-ink'
	const onlyYou = !isSolo && kind === 'expense' && scope === 'personal'
	// Личная трата в семье — замок в чипе вместо отдельной строки «Увидите только вы»
	const scopeLabel = (
		<span className="flex min-w-0 items-center gap-1.5">
			<Icon name={spaceIcon(scope)} size={16} className="shrink-0" />
			<span className="min-w-0 truncate">{SPACE[scope].name}</span>
			{onlyYou && <span className="shrink-0 text-muted2"><Icon name="lock" size={16} label={t('space.onlyYouEntry')} /></span>}
		</span>
	)
	const key = 'key tbox h-[var(--key-h,52px)] justify-center text-xl select-none'
	// Отклик: is-pressed на нажатие (мгновенно), снимается на отпускание/отмену/уход пальца; вибро на Android
	const press_ = (on: boolean) => (e: React.PointerEvent<HTMLElement>) => {
		e.currentTarget.classList.toggle('is-pressed', on)
		if (on) navigator.vibrate?.(8)
	}
	const fx = { onPointerDown: press_(true), onPointerUp: press_(false), onPointerCancel: press_(false), onPointerLeave: press_(false), onContextMenu: (e: React.SyntheticEvent) => e.preventDefault() }

	return (
		<>
			{/* Середина: прокручивается, только если не помещается; сумма приклеена сверху */}
			<div ref={midRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overscroll-behavior:contain]"
				onFocus={(e) => isText(e.target) && setTyping(true)}
				onBlur={() => setTimeout(() => setTyping(isText(document.activeElement)), 250)}>
				<div data-sheet-inner className="flex flex-col gap-2.5 pb-2 [&>*]:shrink-0">
				<div className="sticky top-0 z-[1] bg-panel">
					<label className="flex items-baseline justify-center gap-2">
						<span className="sr-only">Сумма</span>
						<input
							readOnly
							inputMode="none"
							data-autofocus
							className={`w-full min-w-0 bg-transparent text-center leading-tight font-bold outline-none ${expr.length > 14 ? 'text-[1.625rem]' : expr.length > 9 ? 'text-[2.125rem]' : 'text-[2.75rem]'}`}
							value={`${kind === 'income' ? '+' : '−'}${expr || '0'}`}
							aria-describedby="m-cur"
						/>
						<span id="m-cur" className="text-base text-muted">{form.currency}</span>
					</label>
					<p className="min-h-[1.125rem] text-center text-xs text-muted" aria-live="polite">
						{[hasOp(expr) && value !== null ? `= ${fmt(value)}` : '', form.conv].filter(Boolean).join(' ')}
					</p>
				</div>
				{/* Ширина чипов — по содержимому, при нехватке места сжимаются поровну с обрезкой */}
				<div data-chips className="flex gap-1.5 [&>*]:flex-[1_1_auto]">
					{toggleScope ? (
						<button className={`${chip} min-w-0 border-ink px-2 font-bold`} title={t('entry.switchSpace')} onClick={() => { toggleScope(); form.setError('') }}>{scopeLabel}</button>
					) : !isSolo ? (
						<span className={`${chip} min-w-0 border-ink px-2 font-bold`}>{scopeLabel}</span>
					) : <span />}
					{/* Прозрачное поле даты поверх кнопки (как у валюты): на iOS showPicker у скрытого поля молча не срабатывает */}
					<label className={`${chip} relative min-w-0 px-2`}>
						<span className="truncate">{dateLabel(form.date).toUpperCase()}</span>
						<input
							type="date"
							aria-label={t('entry.date')}
							className="absolute inset-0 h-full w-full opacity-0"
							value={form.date}
							onClick={(e) => { try { e.currentTarget.showPicker() } catch {} }}
							onChange={(e) => e.target.value && form.setDate(e.target.value)}
						/>
					</label>
					{/* Валюта и курс в одном чипе: нажатие открывает выбор валюты и поле курса */}
					<button className={`${chip} min-w-0 flex-none! px-2`} aria-expanded={curOpen} aria-controls="m-curp" aria-label={`${t('entry.currency')}: ${form.currency}${form.isForeign ? `, 1 ${form.currency} = ${form.rate} ${st.base}` : ''}`} onClick={() => setCurOpen(!curOpen)}>
						<span className="truncate">{form.isForeign && form.rate ? `${form.currency} · ${form.rate}` : form.currency}</span>
					</button>
				</div>
				{curOpen && (
					<div id="m-curp" className="flex flex-col gap-2">
						<div className="flex gap-1.5 overflow-x-auto" role="group" aria-label={t('entry.currency')}>
							{st.currencies.map((c) => (
								<button key={c} className={chip} aria-pressed={c === form.currency} onClick={() => { form.setCur(c); if (c === st.base) setCurOpen(false) }}>{c}</button>
							))}
						</div>
						{form.isForeign && (
							<div className="flex items-center gap-2 text-xs text-muted">
								<label htmlFor="m-rate">1 {form.currency} =</label>
								<input id="m-rate" className="tfield w-[12ch] py-1" inputMode="decimal" autoComplete="off" value={form.rate} onChange={(e) => form.setRate(amountChars(e.target.value))} />
								<span>{st.base}</span>
							</div>
						)}
					</div>
				)}
				{!isSolo && kind === 'income' && incomeNote && <p className="text-[0.8125rem] text-muted"><IconText name="info">{t('income.personalNote')}</IconText></p>}
				<div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label={kind === 'expense' ? 'Категория' : 'Источник'}>
					{options.length === 0 && <span className="py-2 text-muted uppercase">Нет категорий — добавьте в лимитах</span>}
					{options.map((o) => (
						<button key={o.id} className={chip} aria-pressed={o.id === selected}
							onClick={() => { (kind === 'expense' ? d.setCatId(o.id === selected ? null : o.id) : d.setSrcId(o.id)); form.setError('') }}>
							{o.name.trim()}
						</button>
					))}
				</div>
				<PlanChips d={d} className="flex gap-1.5 overflow-x-auto" />
				<input className="tfield shrink-0 border-line2 py-1" placeholder="Заметка" aria-label="Заметка" autoComplete="off" enterKeyHint="done" value={form.note} onChange={(e) => form.setNote(e.target.value)} />
				</div>
			</div>
			{/* Низ закреплён: ошибка и клавиатура с записью — всегда видны и под большим пальцем */}
			<div className="shrink-0 border-t border-line pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom,0rem))]">
				{form.error && <p className="pb-1.5 uppercase" role="alert"><Problem>{form.error.replace(/\.$/, '')}</Problem></p>}
				{typing ? (
					<button className={`${saveKey} h-11 w-full text-[0.9375rem]`} onClick={onSave}><Icon name="check" size={20} />Записать</button>
				) : (
				<div data-keys className="grid grid-cols-4 gap-1.5" role="group" aria-label="Клавиатура суммы">
					{KEYS.map((k) => (
						<Fragment key={k}>
							<button
								className={key}
								aria-label={k === BACKSPACE ? undefined : k === '−' ? 'Минус' : k === '+' ? 'Плюс' : k === ',' ? 'Запятая' : k}
								{...fx}
								// Символ вводится на нажатие, не на click; ⌫ — стереть один, удержание 500 мс — всё
								onPointerDown={(e) => {
									fx.onPointerDown(e)
									tap(k)
									if (k === BACKSPACE) holdTimer.current = setTimeout(() => setExpr(''), 500)
								}}
								onPointerUp={(e) => { fx.onPointerUp(e); clearTimeout(holdTimer.current) }}
								onPointerCancel={(e) => { fx.onPointerCancel(e); clearTimeout(holdTimer.current) }}
								onPointerLeave={(e) => { fx.onPointerLeave(e); clearTimeout(holdTimer.current) }}
								// Клавиатурный Enter/пробел на сфокусированной клавише (detail 0); касание уже обработано на pointerdown
								onClick={(e) => e.detail === 0 && tap(k)}
							>
								{k === BACKSPACE ? <Icon name="backspace" size={24} label={t('entry.eraseHold')} /> : k}
							</button>
							{/* После 9 — «Записать» в четвёртой колонке на две нижние строки */}
							{k === '9' && (
								<button className={`key ${saveKey} row-span-2 flex-col text-[0.8125rem]`} {...fx} onClick={onSave}>
									<Icon name="check" size={24} />
									Записать
								</button>
							)}
						</Fragment>
					))}
				</div>
				)}
			</div>
		</>
	)
}

// ---------- Голос ----------
function Voice({ midRef, d, scope, listen, onClose, onEdit }: {
	midRef: RefObject<HTMLDivElement | null>
	d: ReturnType<typeof useEntryDraft>; scope: Scope; listen: boolean; onClose: () => void
	/** Строку разбора — в клавиши для ручной правки */
	onEdit: (p: ParsedEntry, amount: string) => void
}) {
	const { isSolo } = useTracker()
	const q = useQuickEntry(isSolo ? [] : d.familyCats, d.personalCats, scope)
	const { rows, listening, hint, st } = q
	// Удержание «+» — запись начинается сразу
	useEffect(() => {
		if (listen) q.toggleMic()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const micHint = listening ? 'Слушаю…' : rows.length ? 'Ещё раз — перезаписать' : 'Нажмите и говорите'
	const write = async () => {
		if (await q.write()) onClose()
	}

	return (
		<>
		<div ref={midRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overscroll-behavior:contain]">
		<div data-sheet-inner className="flex flex-col gap-3 pb-2 [&>*]:shrink-0">
			{!isSolo && (
				<p className="flex flex-wrap items-center gap-x-2 text-xs text-muted uppercase">
					По умолчанию — <IconText name={spaceIcon(scope)}>{SPACE[scope].name}</IconText> · «себе» → <IconText name="space-personal">{SPACE.personal.name}</IconText>
				</p>
			)}
			{hint === 'keyboard' ? (
				<label className="flex items-center gap-2 border-b border-line text-lg">
					<span aria-hidden="true">&gt;</span>
					<span className="sr-only">Траты одной фразой</span>
					<input ref={q.inputRef} className="min-h-16 w-full min-w-0 bg-transparent outline-none placeholder:text-dim" placeholder="кофе 350 и такси 800" autoComplete="off" enterKeyHint="done"
						value={q.text} onChange={(e) => q.setText(e.target.value)} />
				</label>
			) : (
				<p className={`min-h-16 border-b border-line py-1.5 text-lg ${listening ? 'text-muted' : ''}`} aria-live="polite">&gt; {q.text || '…'}</p>
			)}
			{hint === 'keyboard' && <p className="text-muted uppercase">Микрофон клавиатуры: нажмите 🎤 на клавиатуре</p>}
			{hint === 'denied' && <p className="uppercase" role="alert"><Problem>Нет доступа к микрофону — разрешите в настройках браузера</Problem></p>}
			{rows.length === 0 && !listening && (
				<p className="text-[0.8125rem] text-muted2">Например: «кофе триста пятьдесят и такси восемьсот», «вчера продукты две тысячи», «себе кино 900».</p>
			)}
			{rows.length > 0 && (
				<ul aria-live="polite">
					{rows.map(({ i, p }) => {
						const problem = entryProblem(p, st)
						const unsure = p.categoryConfidence !== 'high'
						const reason = scopeReasonText(p, scope)
						const meta = [...(isSolo ? [] : [SPACE[p.scope].name]), ...(p.note ? [p.note] : []), ...(reason ? [reason] : [])].join(' · ')
						const err = problem ?? q.rowErr[i]
						const cats = p.scope === 'personal' ? d.personalCats : d.familyCats
						return (
							<li key={i} className="border-b border-dashed border-line2">
								<div className="grid min-h-12 grid-cols-[1.125rem_minmax(0,1fr)_auto_2.75rem] items-center gap-x-2.5 uppercase">
									<span className={p.scope === 'personal' ? 'text-muted' : ''}>{!isSolo && <Icon name={spaceIcon(p.scope)} size={16} />}</span>
									<button className="flex min-w-0 flex-col py-1 text-left" aria-label={`Править: ${p.raw}`}
										onClick={() => { q.hide(i); d.fillParsed(p); onEdit(p, p.amount === null ? '' : numIn(p.amount)) }}>
										<span className={`truncate ${unsure ? 'text-warn' : ''}`}>{unsure && '? '}{q.catName(p.categoryId)}</span>
										<span className="truncate text-xs text-muted normal-case">{meta || '—'}</span>
									</button>
									<b>{problem === 'Нет суммы' ? '—' : `${p.kind === 'income' ? '+' : '−'}${fmt(p.amount ?? 0)}${p.currency === st.base ? '' : ` ${p.currency}`}`}</b>
									<button className="ib" onClick={() => q.hide(i)}><Icon name="close" size={20} label={t('voice.removeRow')} /></button>
								</div>
								{err && <p className="pb-1 uppercase" role="alert"><Problem>{err}</Problem></p>}
								{unsure && (
									<div className="flex flex-wrap gap-1.5 pb-2" role="group" aria-label="Категория">
										{p.candidates.map((id) => (
											<button key={id} className={chip} aria-pressed={p.categoryId === id} onClick={() => q.setPicked((m) => ({ ...m, [i]: id }))}>{q.catName(id)}</button>
										))}
										<button className={chip} aria-expanded={q.other === i} onClick={() => q.setOther(q.other === i ? null : i)}>Другая</button>
									</div>
								)}
								{q.other === i && (
									<div className="flex flex-wrap gap-1.5 pb-2">
										{cats.map((c) => (
											<button key={c.id} className={chip} onClick={() => { q.setPicked((m) => ({ ...m, [i]: c.id })); q.setOther(null) }}>{termName(c.name)}</button>
										))}
									</div>
								)}
							</li>
						)
					})}
				</ul>
			)}
		</div>
		</div>
		{/* Низ закреплён, как у клавиш: «Говорить» и «Записать N» */}
		<div className="flex shrink-0 flex-col gap-2.5 border-t border-line pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0rem))]">
			<div className="flex flex-col items-center gap-2">
				<MicButton on={listening} onClick={q.toggleMic} />
				<span className="text-xs text-muted uppercase">{micHint}</span>
			</div>
			{rows.length > 0 && (
				<button className="tbox h-[var(--key-h,52px)] justify-center gap-2 border-ink bg-ink text-[0.9375rem] font-bold text-panel uppercase hover:bg-ink disabled:opacity-50" disabled={!q.canWrite} onClick={() => void write()}>
					<Icon name="check" size={20} />Записать {rows.length}
				</button>
			)}
		</div>
		</>
	)
}

/** 120×120: микрофон и «Говорить»; во время записи инвертирована — стоп и «Стоп» */
function MicButton({ on, onClick }: { on: boolean; onClick: () => void }) {
	return (
		<button
			data-autofocus
			className={`flex h-[clamp(5rem,calc(var(--key-h,52px)*2),7.5rem)] w-[clamp(5rem,calc(var(--key-h,52px)*2),7.5rem)] flex-col items-center justify-center gap-2 border-2 text-[0.9375rem] font-bold uppercase ${on ? 'border-ink bg-ink text-panel' : 'border-line2 text-ink'}`}
			aria-pressed={on}
			onClick={onClick}
		>
			<Icon name={on ? 'stop' : 'mic'} size={32} />
			{on ? t('voice.stop') : t('voice.speak')}
		</button>
	)
}
