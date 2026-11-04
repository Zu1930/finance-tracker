'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTracker } from '../TrackerProvider'
import type { Category, Expense } from '@/lib/types'
import { parsePhrase, type ParsedEntry, type QuickScope } from '@/lib/quick-entry/parse'
import { buildDictionary, visibleExpenses } from '@/lib/quick-entry/dictionary'
import { entryProblem, toExpense } from '@/lib/quick-entry/entry'
import { fmt, minus, termName, todayStr, uid } from '@/lib/utils'
import { SPACE, glyph } from '@/lib/space'
import { Icon } from '../icons/Icon'
import { IconText, Problem, spaceIcon } from '../icons/IconText'
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
				defaultScope
			}),
		[phrase, st.base, st.currencies, familyCats, personalCats, dictionary, defaultScope]
	)
	const rows = parsed
		.map((p, i) => ({ i, p: picked[i] ? { ...p, categoryId: picked[i], categoryConfidence: 'high' as const, candidates: [] } : p }))
		.filter((r) => !hidden.has(r.i))
	const blocked = rows.some((r) => r.p.categoryConfidence === 'none' || entryProblem(r.p, st))
	const canWrite = rows.length > 0 && !blocked && !busy
	const catName = (id: string | null) => termName([...familyCats, ...personalCats].find((c) => c.id === id)?.name ?? 'Категория')
	const hide = (i: number) => setHidden((h) => new Set(h).add(i))

	/** true — записано всё */
	const write = async (): Promise<boolean> => {
		if (!canWrite) return false
		setBusy(true)
		const written: Expense[] = []
		const errors: Record<number, string> = {}
		// По одной: упавшая не откатывает остальные, её ошибка — в её строке
		for (const { i, p } of rows) {
			const e = toExpense(p, st, data.me.id, uid(), Date.now())!
			const err = await addEntry('expense', e)
			if (err) errors[i] = err
			else {
				written.push(e)
				hide(i)
			}
		}
		setRowErr(errors)
		setBusy(false)
		if (written.length) {
			// ЗАПИСАНО 2: ◇ −350 · ◆ −800; в solo — сумма
			const what = isSolo ? `${minus(written.reduce((s, e) => s + e.base, 0))} ${st.base}` : written.map((e) => `${glyph(e.scope)} ${minus(e.amount)}`).join(' · ')
			toast(`Записано ${written.length}: ${what}`, 'Отменить', () => written.forEach((e) => removeEntry('expense', e)))
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

/** Строка «● Голос» над формой на десктопе. Разбор всегда показывается перед записью; доходы, регулярные и плановые здесь не вводятся */
export function QuickEntry({ familyCats, personalCats, defaultScope, onEdit }: Props) {
	const q = useQuickEntry(familyCats, personalCats, defaultScope)
	const { text, setText, phrase, setPhrase, rows, hide, setPicked, rowErr, other, setOther, listening, hint, inputRef, toggleMic, write, canWrite, catName, st, isSolo } = q

	// «/» — в поле (если фокус не в другом поле), Alt + M — микрофон
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

	return (
		<section className="mb-6" aria-label="Голосовой ввод">
			<div className="flex items-center gap-3">
				<button
					// Без aria-pressed: tbox инвертирует нажатую кнопку, а запись должна быть красной
					className={`tb mbare h-[52px] w-[52px] shrink-0 sm:h-auto sm:min-h-11 sm:w-auto ${listening ? 'border-bad text-bad hover:bg-transparent' : ''}`}
					onClick={toggleMic}
				>
					{/* REC: микрофон мигает, пока идёт запись; при «уменьшить движение» — просто красный */}
					<span className={`inline-flex items-center gap-2 ${listening ? 'motion-safe:animate-[rec_1.2s_ease-in-out_infinite]' : ''}`}>
						<Icon name="mic" size={20} />
						{listening ? 'Слушаю…' : t('entry.voice')}
					</span>
				</button>
				<span aria-hidden="true" className="text-muted">&gt;</span>
				<label htmlFor="quick" className="sr-only">Траты одной фразой</label>
				<input
					id="quick"
					ref={inputRef}
					className="tfield flex-1"
					placeholder="кофе 350 и такси 800"
					autoComplete="off"
					enterKeyHint="done"
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key !== 'Enter') return
						e.preventDefault()
						// Разбор отстаёт на 150 мс — Enter сразу после ввода разбирает текущий текст
						if (phrase !== text) setPhrase(text)
						else void write()
					}}
				/>
				<span className="hidden text-muted2 uppercase sm:block touch:hidden">Alt + M · /</span>
				<Link href="/settings/input/siri" className="ib"><Icon name="help" size={20} label={t('voice.help')} /></Link>
			</div>
			{hint === 'keyboard' && <p className="mt-2 text-muted uppercase">Микрофон клавиатуры: нажмите 🎤 на клавиатуре</p>}
			{hint === 'denied' && <p className="mt-2 uppercase" role="alert"><Problem>Нет доступа к микрофону — разрешите в настройках браузера</Problem></p>}

			{rows.length > 0 && (
				<>
					<ul className="mt-3" aria-live="polite">
						{rows.map(({ i, p }) => {
							const problem = entryProblem(p, st)
							const unsure = p.categoryConfidence !== 'high'
							const cat = (
								<span className={unsure ? 'text-warn' : ''}>
									{unsure && '? '}
									{catName(p.categoryId)}
								</span>
							)
							const amount = problem === 'Нет суммы' ? '—' : `−${fmt(p.amount ?? 0)} ${p.currency}`
							const reason = scopeReasonText(p, defaultScope)
							const meta = [...(isSolo ? [] : [SPACE[p.scope].name]), dateLabel(p.date), ...(reason ? [reason] : [])]
							const mark = !isSolo && <Icon name={spaceIcon(p.scope)} size={16} className={`mr-2 ${p.scope === 'personal' ? 'text-muted' : ''}`} />
							const err = problem ?? rowErr[i]
							const cats = p.scope === 'personal' ? personalCats : familyCats
							return (
								<li key={i} className="border-b border-dashed border-line2 py-1 uppercase">
									<div className="flex items-center gap-2">
										<button className="min-w-0 flex-1 text-left hover:bg-hover" onClick={() => { hide(i); onEdit(p) }} aria-label={`Править вручную: ${p.raw}`}>
											{/* Мобильный: две строки, как логи */}
											<span className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:hidden">
												<span className="truncate">{mark}{cat}</span>
												<b className="text-right">{amount}</b>
												<span className="col-span-2 truncate text-xs text-muted">{[...meta, ...(p.note ? [p.note] : [])].join(' · ')}</span>
											</span>
											<span className="hidden min-w-0 truncate sm:block">
												{mark}<b>{amount}</b> → {cat} · {meta.join(' · ')}
												{p.note && <span className="ml-2 text-muted normal-case">// {p.note}</span>}
											</span>
										</button>
										<button className="ib" onClick={() => hide(i)}><Icon name="close" size={20} label={t('voice.removeRow')} /></button>
									</div>
									{err && <p role="alert"><Problem>{err}</Problem></p>}
									{unsure && (
										<div className="mt-1 mb-1 flex flex-wrap gap-2" role="group" aria-label="Категория">
											{p.candidates.map((id) => (
												<button key={id} className="tb" aria-pressed={p.categoryId === id} onClick={() => setPicked((m) => ({ ...m, [i]: id }))}>
													{catName(id)}
												</button>
											))}
											<button className="tb" aria-expanded={other === i} onClick={() => setOther(other === i ? null : i)}>Другая</button>
										</div>
									)}
									{other === i && (
										<div className="mt-1 mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
											{cats.map((c) => (
												<button key={c.id} className="tbox min-h-11 px-2 py-2 text-left" onClick={() => { setPicked((m) => ({ ...m, [i]: c.id })); setOther(null) }}>
													<span className="min-w-0 [overflow-wrap:anywhere]">{termName(c.name)}</span>
												</button>
											))}
										</div>
									)}
								</li>
							)
						})}
					</ul>
					<button className="tb mt-3 h-[52px] text-base font-bold max-sm:w-full sm:h-auto sm:px-6 sm:py-2" disabled={!canWrite} onClick={() => void write()}>
						{rows.length > 1 ? `Записать ${rows.length}` : 'Записать'}
					</button>
				</>
			)}
		</section>
	)
}
