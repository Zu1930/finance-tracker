'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTracker } from '../TrackerProvider'
import type { Category, Expense, Income } from '@/lib/types'
import { parsePhrase, type ParsedEntry, type QuickScope } from '@/lib/quick-entry/parse'
import { buildDictionary, visibleExpenses } from '@/lib/quick-entry/dictionary'
import { entryProblem, toExpense, toIncome } from '@/lib/quick-entry/entry'
import { fmt, incomeSources, minus, termName, todayStr, uid } from '@/lib/utils'
import { SPACE, glyph } from '@/lib/space'
import { Icon } from '../icons/Icon'
import { Problem, spaceIcon } from '../icons/IconText'
import { t } from '@/lib/i18n'
import { dateLabel } from './EntryForm'

/** Web Speech API: в TS-типах DOM его нет, нужен минимум */
type Recognition = {
	lang: string
	interimResults: boolean
	continuous: boolean
	start: () => void
	stop: () => void
	abort: () => void
	onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
	onerror: ((e: { error: string }) => void) | null
	onend: (() => void) | null
}
const speechApi = (): (new () => Recognition) | undefined => {
	const w = window as unknown as Record<string, new () => Recognition>
	return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/** Почему у строки разбора другой бюджет, чем текущий: «себе», категория только личная */
export function scopeReasonText(p: ParsedEntry, defaultScope: QuickScope): string | null {
	if (p.scope === defaultScope) return null
	if (p.kind === 'income') return t('income.personalMeta')
	if (p.scopeReason === 'word') return `«${p.scopeWord}»`
	if (p.scopeReason === 'category') return `категория только ${p.scope === 'personal' ? 'личная' : 'семейная'}`
	return null
}

/**
 * Голосовой и текстовый ввод трат: «кофе 350 и такси 800» → разбор → запись. Общее для строки на десктопе
 * и формы на телефоне. defaultScope — текущий бюджет: по нему пишется всё, где бюджет не назван и не ясен по категории
 */
export function useQuickEntry(familyCats: Category[], personalCats: Category[], defaultScope: QuickScope) {
	const { data, isSolo, addEntry, removeEntry, toast } = useTracker()
	const st = data.settings!
	const [text, setText] = useState('')
	const [phrase, setPhrase] = useState('')
	// Состояние строк разбора по их номеру; сбрасывается с новой фразой
	const [hidden, setHidden] = useState<Set<number>>(new Set())
	const [picked, setPicked] = useState<Record<number, string>>({})
	const [rowErr, setRowErr] = useState<Record<number, string>>({})
	const [other, setOther] = useState<number | null>(null)
	const [busy, setBusy] = useState(false)
	const [listening, setListening] = useState(false)
	const [hint, setHint] = useState<'' | 'keyboard' | 'denied'>('')
	const inputRef = useRef<HTMLInputElement>(null)
	const recRef = useRef<Recognition | null>(null)

	useEffect(() => {
		const t = setTimeout(() => setPhrase(text), 150)
		return () => clearTimeout(t)
	}, [text])
	useEffect(() => {
		setHidden(new Set())
		setPicked({})
		setRowErr({})
		setOther(null)
	}, [phrase])
	useEffect(() => () => recRef.current?.abort(), [])

	const dictionary = useMemo(() => buildDictionary(visibleExpenses(data)), [data])
	const parsed = useMemo(
		() =>
			parsePhrase(phrase, {
				today: todayStr(),
				base: st.base,
				currencies: st.currencies,
				familyCategories: familyCats,
				personalCategories: personalCats,
				dictionary,
				defaultScope,
				incomeSources: incomeSources(st)
			}),
		[phrase, st, familyCats, personalCats, dictionary, defaultScope]
	)
	const rows = parsed
		.map((p, i) => ({ i, p: picked[i] ? { ...p, categoryId: picked[i], categoryConfidence: 'high' as const, candidates: [] } : p }))
		.filter((r) => !hidden.has(r.i))
	const blocked = rows.some((r) => r.p.categoryConfidence === 'none' || entryProblem(r.p, st))
	const canWrite = rows.length > 0 && !blocked && !busy
	const catName = (id: string | null) => termName([...familyCats, ...personalCats, ...incomeSources(st)].find((c) => c.id === id)?.name ?? 'Категория')
	const hide = (i: number) => setHidden((h) => new Set(h).add(i))

	/** true — записано всё */
	const write = async (): Promise<boolean> => {
		if (!canWrite) return false
		setBusy(true)
		const written: ({ kind: 'expense'; e: Expense } | { kind: 'income'; e: Income })[] = []
		const errors: Record<number, string> = {}
		// По одной: упавшая не откатывает остальные, её ошибка — в её строке. Доход — всегда личный мой, в любом бюджете
		for (const { i, p } of rows) {
			const w = p.kind === 'income'
				? { kind: 'income' as const, e: toIncome(p, st, data.me.id, uid(), Date.now())! }
				: { kind: 'expense' as const, e: toExpense(p, st, data.me.id, uid(), Date.now())! }
			const err = await addEntry(w.kind, w.e)
			if (err) errors[i] = err
			else {
				written.push(w)
				hide(i)
			}
		}
		setRowErr(errors)
		setBusy(false)
		if (written.length) {
			// ЗАПИСАНО 2: ◇ −350 · ◆ −800 · ◇ +2100; в solo — сумма трат и доход
			const sign = (w: (typeof written)[number]) => (w.kind === 'income' ? `+${fmt(w.e.amount)}` : minus(w.e.amount))
			const what = isSolo
				? written.map((w) => `${sign(w)} ${w.e.currency}`).join(' · ')
				: written.map((w) => `${glyph(w.kind === 'income' ? 'personal' : w.e.scope)} ${sign(w)}`).join(' · ')
			toast(`Записано ${written.length}: ${what}`, 'Отменить', () => written.forEach((w) => removeEntry(w.kind, w.e)))
		}
		const ok = !Object.keys(errors).length
		if (ok) {
			setText('')
			setPhrase('')
		}
		return ok && written.length > 0
	}

	const toggleMic = () => {
		if (recRef.current) return recRef.current.stop()
		const Api = speechApi()
		// Нет API (Firefox, часть iOS) — диктовка через микрофон системной клавиатуры
		if (!Api) {
			inputRef.current?.focus()
			return setHint('keyboard')
		}
		const r = new Api()
		r.lang = 'ru-RU'
		r.interimResults = true
		r.continuous = false
		r.onresult = (e) => setText(Array.from(e.results, (x) => x[0].transcript).join(''))
		// Новая запись заменяет прежнюю фразу
		setText('')
		r.onerror = (e) => {
			if (e.error === 'not-allowed') setHint('denied')
			else if (e.error !== 'no-speech' && e.error !== 'aborted') {
				// service-not-allowed, network, audio-capture: распознавание есть, но здесь не работает
				setHint('keyboard')
				inputRef.current?.focus()
			}
		}
		r.onend = () => {
			recRef.current = null
			setListening(false)
		}
		setHint('')
		try {
			r.start()
			recRef.current = r
			setListening(true)
		} catch {
			setHint('keyboard')
			inputRef.current?.focus()
		}
	}

	return {
		text, setText, phrase, setPhrase, rows, hide, picked, setPicked, rowErr, other, setOther, busy, listening, hint, setHint,
		inputRef, toggleMic, write, canWrite, catName, st, isSolo, defaultScope
	}
}

export type Quick = ReturnType<typeof useQuickEntry>

type Props = {
	familyCats: Category[]
	personalCats: Category[]
	/** Текущий бюджет */
	defaultScope: QuickScope
	/** Перенести трату в обычную форму для ручной правки */
	onEdit: (p: ParsedEntry) => void
}

/**
 * Командная строка на десктопе: «> кофе 350 и такси 800», под ней разбор существующим парсером, Enter — записать,
 * Esc — очистить, «/» — фокус в строку. Доходы, регулярные и плановые — в форме ниже
 */
export function QuickEntry({ familyCats, personalCats, defaultScope, onEdit }: Props) {
	const q = useQuickEntry(familyCats, personalCats, defaultScope)
	const { text, setText, phrase, setPhrase, rows, hide, setPicked, rowErr, listening, hint, inputRef, toggleMic, write, canWrite, catName, st, isSolo } = q

	// «/» — в строку (если фокус не в другом поле), Alt + M — микрофон; ?focus=cmd — из палитры команд
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.altKey && e.code === 'KeyM') {
				e.preventDefault()
				return toggleMic()
			}
			if (e.key !== '/' || e.altKey || e.ctrlKey || e.metaKey) return
			const a = document.activeElement as HTMLElement | null
			if (a && (a.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName))) return
			e.preventDefault()
			inputRef.current?.focus()
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	})
	useEffect(() => {
		const focus = () => inputRef.current?.focus()
		window.addEventListener(FOCUS_CMD, focus)
		if (new URLSearchParams(window.location.search).get('focus') === 'cmd') {
			focus()
			window.history.replaceState(null, '', window.location.pathname)
		}
		return () => window.removeEventListener(FOCUS_CMD, focus)
	}, [inputRef])

	return (
		<section className="flex flex-col gap-3.5" aria-label={t('cmd.title')}>
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="sec">{t('cmd.title')}</h2>
				{!isSolo && <span className="text-right text-xs text-muted uppercase">{t('cmd.default', { x: SPACE[defaultScope].name.toLowerCase() })}</span>}
			</div>
			<div className="flex items-center gap-2.5">
				<b aria-hidden="true" className="text-xl">&gt;</b>
				<input
					id="quick"
					ref={inputRef}
					className="min-w-0 flex-1 border-b-2 border-ink bg-transparent py-1 text-xl outline-none placeholder:text-dim"
					aria-label={t('cmd.label')}
					placeholder={t('cmd.placeholder')}
					autoComplete="off"
					enterKeyHint="done"
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Escape' && text) {
							e.preventDefault()
							setText('')
							return setPhrase('')
						}
						if (e.key !== 'Enter') return
						e.preventDefault()
						// Разбор отстаёт на 150 мс — Enter сразу после ввода разбирает текущий текст
						if (phrase !== text) setPhrase(text)
						else void write()
					}}
				/>
				<button className={`ib ${listening ? 'text-bad motion-safe:animate-[rec_1.2s_ease-in-out_infinite]' : ''}`} onClick={toggleMic}>
					<Icon name={listening ? 'stop' : 'mic'} size={20} label={listening ? t('voice.stopRec') : t('voice.start')} />
				</button>
			</div>
			{hint === 'keyboard' && <p className="text-muted uppercase">Микрофон клавиатуры: нажмите 🎤 на клавиатуре</p>}
			{hint === 'denied' && <p className="uppercase" role="alert"><Problem>Нет доступа к микрофону — разрешите в настройках браузера</Problem></p>}

			{rows.length === 0 ? (
				<p className="text-[0.8125rem] text-muted2">{t('cmd.hint')}</p>
			) : (
				<>
					<ul aria-live="polite">
						{rows.map(({ i, p }) => {
							const problem = entryProblem(p, st)
							const unsure = p.categoryConfidence !== 'high'
							const reason = scopeReasonText(p, defaultScope)
							const meta = [dateLabel(p.date), ...(reason ? [reason] : []), ...(p.note ? [p.note] : [])].join(' · ')
							const err = problem ?? rowErr[i]
							return (
								<li key={i} className="border-b border-dashed border-line2 py-2">
									<div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] items-baseline gap-x-2.5">
										<span className={p.scope === 'personal' ? 'text-muted' : ''}>{!isSolo && <Icon name={spaceIcon(p.scope)} size={16} />}</span>
										<button className="min-w-0 text-left uppercase hover:underline" onClick={() => { hide(i); onEdit(p) }} aria-label={`${t('cmd.toForm')}: ${p.raw}`}>
											<span className={`block truncate ${unsure ? 'text-warn' : ''}`}>{unsure && '? '}{catName(p.categoryId)}</span>
											<span className="block truncate text-xs text-muted normal-case">{meta}</span>
										</button>
										<b>{problem === 'Нет суммы' ? '—' : `${p.kind === 'income' ? '+' : '−'}${fmt(p.amount ?? 0)} ${p.currency}`}</b>
										<button className="ib -my-2" onClick={() => hide(i)}><Icon name="close" size={16} label={t('voice.removeRow')} /></button>
									</div>
									{err && <p role="alert"><Problem>{err}</Problem></p>}
									{unsure && (
										<div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Категория">
											{p.candidates.map((id) => (
												<button key={id} className="tb" aria-pressed={p.categoryId === id} onClick={() => setPicked((m) => ({ ...m, [i]: id }))}>{catName(id)}</button>
											))}
										</div>
									)}
								</li>
							)
						})}
					</ul>
					<div className="flex items-center justify-between gap-3">
						<span className="text-xs text-muted uppercase"><kbd className="kbd">Enter</kbd> {t('cmd.write')} · <kbd className="kbd">Esc</kbd> {t('cmd.clear')}</span>
						<button className="tbox min-h-11 border-ink bg-ink px-4 font-bold text-panel uppercase hover:bg-ink" disabled={!canWrite} onClick={() => void write()}>
							{t('cmd.writeN', { n: rows.length })}
						</button>
					</div>
				</>
			)}
		</section>
	)
}

/** Событие «фокус в командную строку» — из палитры команд, когда строка уже на экране */
export const FOCUS_CMD = 'ft:focus-cmd'
