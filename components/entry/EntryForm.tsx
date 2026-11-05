'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTracker } from '../TrackerProvider'
import { inField } from '../SpaceProvider'
import { Problem } from '../icons/IconText'
import { useNarrow } from '../AsciiBar'
import { amountChars, ddmm, fmt, numIn, parseAmount, parseRate, todayStr } from '@/lib/utils'

/** На мобильном фокус в сумму сам не переводим: выскочит клавиатура и закроет форму */
const isDesktop = () => window.matchMedia('(min-width: 640px)').matches

/** Подпись даты на кнопке записи: сегодня, вчера или 12.10 */
export function dateLabel(date: string) {
	const today = todayStr()
	if (!date || date === today) return 'Сегодня'
	const y = new Date()
	y.setDate(y.getDate() - 1)
	const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`
	return date === yesterday ? 'Вчера' : ddmm(date)
}

type Option = { id: string; name: string }

export type EntryMode = 'expense' | 'income'

/** Что в форме зависит от режима */
const MODE_UI: Record<
	EntryMode,
	{ amountLabel: string; optionsTitle: string; notePlaceholder: string }
> = {
	expense: {
		amountLabel: 'Amount −',
		optionsTitle: 'Category',
		notePlaceholder: 'необязательно'
	},
	income: {
		amountLabel: 'Amount +',
		optionsTitle: 'Source',
		notePlaceholder: 'например: аванс, проект, возврат'
	}
}

/**
 * Общее состояние форм трат и поступлений.
 * defaultCurrency — валюта контекста: общая для семейных трат, моя для личных трат и доходов.
 * При смене контекста валюта переключается на его валюту; сумма, заметка и дата остаются
 */
export function useEntryForm(defaultCurrency: string) {
	const { data, updateRates } = useTracker()
	const st = data.settings!
	const [cur, setCurState] = useState(defaultCurrency)
	const [amount, setAmount] = useState('')
	const [rate, setRate] = useState('')
	const [note, setNote] = useState('')
	const [date, setDate] = useState(todayStr)
	const [error, setError] = useState('')
	const amountRef = useRef<HTMLInputElement>(null)
	/** Валюта, заданная fill: следующая смена контекста не должна её сбросить */
	const heldCur = useRef<string | null>(null)

	const focusAmount = () => {
		if (isDesktop()) amountRef.current?.focus()
	}
	useEffect(focusAmount, [])

	const currency = st.currencies.includes(cur) ? cur : st.base
	const isForeign = currency !== st.base

	const setCur = (c: string) => {
		setCurState(c)
		setRate(c === st.base ? '' : numIn(st.rates[c]))
	}

	// Сменился контекст (семья / личное / доход) или моя валюта в настройках — переключиться на его валюту
	useEffect(() => {
		setCur(heldCur.current ?? defaultCurrency)
		heldCur.current = null
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [defaultCurrency])

	const a = parseAmount(amount)
	const r = parseRate(rate)
	const conv =
		isForeign && a && a > 0 && r && r > 0 ? `// ≈ ${fmt(a * r)} ${st.base}` : ''

	/**
	 * Проверяет сумму, затем extra (например, выбрана ли категория), затем курс.
	 * При успехе сохраняет изменённый курс в настройки и возвращает общие поля записи
	 */
	const collect = (extra?: () => string | null) => {
		if (a === null) return void setError('Введите сумму.')
		if (!(a > 0)) return void setError('Сумма должна быть числом больше нуля.')
		const extraError = extra?.()
		if (extraError) return void setError(extraError)
		const usedRate = isForeign ? r : 1
		if (!(usedRate && usedRate > 0))
			return void setError(`Укажите курс ${currency} к ${st.base}.`)

		if (isForeign && st.rates[currency] !== usedRate) {
			updateRates({ [currency]: usedRate! })
		}
		return {
			amount: a,
			currency,
			rate: usedRate,
			base: Math.round(a * usedRate * 100) / 100,
			note: note.trim().slice(0, 140),
			date: date || todayStr(),
			ts: Date.now()
		}
	}

	/** Заполнить форму целиком (трата из голосового ввода). contextChanges — следом сменится валюта контекста */
	const fill = (v: { amount: string; currency: string; note: string; date: string }, contextChanges: boolean) => {
		setCur(v.currency)
		heldCur.current = contextChanges ? v.currency : null
		setAmount(v.amount)
		setNote(v.note)
		setDate(v.date)
		setError('')
	}

	/** После записи: очистить сумму и заметку, вернуть фокус в сумму */
	const reset = () => {
		setAmount('')
		setNote('')
		setError('')
		focusAmount()
	}

	return {
		st,
		currency,
		isForeign,
		setCur,
		amount,
		setAmount,
		rate,
		setRate,
		note,
		setNote,
		date,
		setDate,
		error,
		setError,
		amountRef,
		focusAmount,
		conv,
		collect,
		fill,
		reset
	}
}

export type EntryForm = ReturnType<typeof useEntryForm>

/**
 * Alt + 1..9 — выбрать вариант по номеру в списке. spaceKeys — Alt + 1 / 2 / 3 вне полей ввода заняты
 * переключением бюджета (SpaceProvider), здесь они работают только из поля
 */
export function useAltPick(options: Option[], pick: (id: string) => void, spaceKeys = false) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || !/^Digit[1-9]$/.test(e.code)) return
			const n = Number(e.code.slice(5))
			if (spaceKeys && n <= 3 && !inField(document.activeElement)) return
			const o = options[n - 1]
			if (o) {
				e.preventDefault()
				pick(o.id)
			}
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [options, pick, spaceKeys])
}

type FormProps = {
	mode: EntryMode
	form: EntryForm
	/** Категории или источники — в зависимости от режима */
	options: Option[]
	selectedId: string | null
	onPick: (id: string) => void
	/** Сумма начата с «+» — переключиться на доход */
	onPlus: () => void
	/** Что показать вместо пустой сетки (нет личных категорий) */
	empty?: ReactNode
	/** Под сеткой вариантов: чипы пунктов плана */
	extra?: ReactNode
	onSubmit: () => void
}

/** Поля формы: сумма и валюты, курс, сетка вариантов, заметка, дата, кнопка записи, ошибка */
export function EntryForm({
	mode,
	form,
	options,
	selectedId,
	onPick,
	onPlus,
	empty,
	extra,
	onSubmit
}: FormProps) {
	const { st, currency, isForeign, amountRef } = form
	const ui = MODE_UI[mode]
	const narrow = useNarrow()
	const dateRef = useRef<HTMLInputElement>(null)
	// Мобильный: поле даты скрыто, «Другая дата» открывает системный выбор; без showPicker — показываем поле
	const [showDate, setShowDate] = useState(false)
	const pickDate = () => {
		try {
			dateRef.current!.showPicker()
		} catch {
			setShowDate(true)
		}
	}
	const submitLabel = `Записать · ${dateLabel(form.date)}`

	const onEnter = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			onSubmit()
		}
	}

	// Размеры — от ширины колонки, где стоит форма (свёрнутая форма на десктопе бывает уже 360px), а не от экрана
	return (
		<div className="@container">
			<div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3">
				<div className="flex w-full min-w-0 flex-col gap-1 @min-[480px]:w-auto @min-[480px]:flex-[1_1_17.5rem] @min-[480px]:flex-row @min-[480px]:items-baseline @min-[480px]:gap-4">
					<label
						htmlFor="amount"
						className="lbl shrink-0 text-base font-bold text-ink @min-[480px]:text-[1.75rem]"
					>
						{ui.amountLabel}
					</label>
					<input
						id="amount"
						ref={amountRef}
						className="tfield min-h-0 w-full flex-1 border-b-2 border-ink pt-0 pb-1 text-[2.5rem] leading-none font-bold sm:text-[2.75rem]"
						inputMode="decimal"
						autoComplete="off"
						placeholder="0"
						value={form.amount}
						onChange={(e) => {
							const v = amountChars(e.target.value)
							if (v.startsWith('+')) onPlus()
							form.setAmount(v.replace(/^\+/, ''))
						}}
						onKeyDown={onEnter}
					/>
				</div>
				{/* Валюты переносятся на новую строку целиком и не сжимаются */}
				<div
					className="flex shrink-0 flex-wrap gap-2"
					role="group"
					aria-label="Валюта"
				>
					{st.currencies.map((c) => (
						<button
							key={c}
							className="tb tb-tight shrink-0"
							aria-pressed={c === currency}
							onClick={() => form.setCur(c)}
						>
							{c}
						</button>
					))}
				</div>
			</div>
			{isForeign && (
				<div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
					<label
						htmlFor="rate"
						className="lbl"
					>
						Rate: 1 {currency} =
					</label>
					<input
						id="rate"
						className="tfield w-[12ch]"
						inputMode="decimal"
						autoComplete="off"
						placeholder="курс"
						value={form.rate}
						onChange={(e) => form.setRate(amountChars(e.target.value))}
						onKeyDown={onEnter}
					/>
					<span className="text-muted">{st.base}</span>
					<output className="text-ink">{form.conv}</output>
				</div>
			)}
			<p className="mt-2 text-muted2 pointer-coarse:hidden">
				// МОЖНО СКЛАДЫВАТЬ: 450+120
			</p>

			<h2 className="sec mt-8">{ui.optionsTitle}</h2>
			{options.length === 0 && empty ? (
				<div className="mt-3">{empty}</div>
			) : (
			<div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))] items-stretch gap-2">
				{options.map((o, i) => (
					<button
						key={o.id}
						aria-pressed={o.id === selectedId}
						title={o.name}
						aria-label={o.name}
						className="tbox min-h-11 gap-2 px-2 py-2 text-left @min-[480px]:px-3"
						onClick={() => {
							onPick(o.id)
							form.setError('')
							form.focusAmount()
						}}
					>
						{i < 9 && (
							<span
								aria-hidden="true"
								className="hidden shrink-0 @min-[480px]:inline touch:hidden"
							>
								[{i + 1}]
							</span>
						)}
						{/* С пробелами, перенос только по словам, не больше двух строк */}
						<span className="line-clamp-2 min-w-0 text-ellipsis break-normal hyphens-none">
							{o.name.trim()}
						</span>
					</button>
				))}
			</div>
			)}
			{extra}

			<div className="mt-8 flex flex-wrap items-end gap-x-6 gap-y-4">
				<div className="flex min-w-[15rem] flex-[2_1_15rem] items-center gap-3">
					<label
						htmlFor="note"
						className="lbl max-sm:sr-only"
					>
						Note
					</label>
					<input
						id="note"
						className="tfield flex-1"
						placeholder={narrow ? 'Комментарий' : ui.notePlaceholder}
						autoComplete="off"
						value={form.note}
						onChange={(e) => form.setNote(e.target.value)}
						onKeyDown={onEnter}
					/>
				</div>
				<div className={`flex-[1_1_12.5rem] items-center gap-3 ${showDate ? 'flex' : 'max-sm:sr-only sm:flex'}`}>
					<label
						htmlFor="date"
						className="lbl shrink-0 whitespace-nowrap"
					>
						Date
					</label>
					<input
						id="date"
						ref={dateRef}
						className="tfield flex-1"
						type="date"
						value={form.date}
						onChange={(e) => form.setDate(e.target.value)}
						onKeyDown={onEnter}
					/>
				</div>
				<div className="hidden sm:block">
					<button
						className="tb px-6 py-3 text-base font-bold"
						onClick={onSubmit}
					>
						Enter ↵ Записать
					</button>
				</div>
			</div>
			{/* Мобильный: кнопка с датой прилипает над нижней панелью, пока видна форма */}
			<div className="sticky bottom-[calc(3.25rem+env(safe-area-inset-bottom,0rem))] z-[5] -mx-4 mt-4 bg-panel px-4 pt-1 pb-3 sm:hidden">
				<div className="flex justify-end">
					<button className="min-h-11 text-xs text-muted uppercase underline underline-offset-4" onClick={pickDate}>
						Другая дата
					</button>
				</div>
				<button
					className="tb h-[3.25rem] w-full text-base font-bold"
					onClick={onSubmit}
				>
					{submitLabel}
				</button>
			</div>
			<p
				className="mt-3 min-h-5 uppercase"
				role="alert"
			>
				<Problem>{form.error.replace(/\.$/, '')}</Problem>
			</p>
		</div>
	)
}
