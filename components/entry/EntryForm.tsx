'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTracker } from '../TrackerProvider'
import { amountChars, fmt, parseAmount, termName, todayStr } from '@/lib/utils'

type Option = { id: string; name: string }

export type EntryMode = 'expense' | 'income'

/** Что в форме зависит от режима */
const MODE_UI: Record<
	EntryMode,
	{ amountLabel: string; optionsTitle: string; grid: string; notePlaceholder: string }
> = {
	expense: {
		amountLabel: 'Amount −',
		optionsTitle: 'Category',
		grid: 'grid-cols-2 sm:grid-cols-4',
		notePlaceholder: 'необязательно'
	},
	income: {
		amountLabel: 'Amount +',
		optionsTitle: 'Source',
		grid: 'grid-cols-2 sm:grid-cols-5',
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

	useEffect(() => {
		amountRef.current?.focus()
	}, [])

	const currency = st.currencies.includes(cur) ? cur : st.base
	const isForeign = currency !== st.base

	const setCur = (c: string) => {
		setCurState(c)
		setRate(c === st.base ? '' : String(st.rates[c] ?? ''))
	}

	// Сменился контекст (семья / личное / доход) или моя валюта в настройках — переключиться на его валюту
	useEffect(() => {
		setCur(defaultCurrency)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [defaultCurrency])

	const a = parseAmount(amount)
	const r = parseAmount(rate)
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

	/** После записи: очистить сумму и заметку, вернуть фокус в сумму */
	const reset = () => {
		setAmount('')
		setNote('')
		setError('')
		amountRef.current?.focus()
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
		conv,
		collect,
		reset
	}
}

export type EntryForm = ReturnType<typeof useEntryForm>

/** Alt + 1..9 — выбрать вариант по номеру в списке */
export function useAltPick(options: Option[], pick: (id: string) => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || !/^Digit[1-9]$/.test(e.code)) return
			const o = options[Number(e.code.slice(5)) - 1]
			if (o) {
				e.preventDefault()
				pick(o.id)
			}
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [options, pick])
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

	const onEnter = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			onSubmit()
		}
	}

	return (
		<>
			<div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3">
				<div className="flex min-w-0 flex-[1_1_280px] items-baseline gap-4">
					<label
						htmlFor="amount"
						className="lbl shrink-0 text-xl font-bold text-ink sm:text-[28px]"
					>
						{ui.amountLabel}
					</label>
					<input
						id="amount"
						ref={amountRef}
						className="tfield min-h-0 w-0 flex-1 border-b-2 border-ink pt-0 pb-1 text-[34px] leading-none font-bold sm:text-[44px]"
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
				<div
					className="flex gap-2"
					role="group"
					aria-label="Валюта"
				>
					{st.currencies.map((c) => (
						<button
							key={c}
							className="tb tb-tight"
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
			<div className={`mt-3 grid gap-2 ${ui.grid}`}>
				{options.map((o, i) => (
					<button
						key={o.id}
						aria-pressed={o.id === selectedId}
						className="tbox min-h-11 gap-2 px-2 py-2 text-left sm:px-3"
						onClick={() => {
							onPick(o.id)
							form.setError('')
							amountRef.current?.focus()
						}}
					>
						{i < 9 && (
							<span
								aria-hidden="true"
								className="shrink-0"
							>
								[{i + 1}]
							</span>
						)}
						<span className="min-w-0 [overflow-wrap:anywhere]">
							{termName(o.name)}
						</span>
					</button>
				))}
			</div>
			)}
			{extra}

			<div className="mt-8 flex flex-wrap items-end gap-x-6 gap-y-4">
				<div className="flex min-w-[240px] flex-[2_1_240px] items-center gap-3">
					<label
						htmlFor="note"
						className="lbl"
					>
						Note
					</label>
					<input
						id="note"
						className="tfield flex-1"
						placeholder={ui.notePlaceholder}
						autoComplete="off"
						value={form.note}
						onChange={(e) => form.setNote(e.target.value)}
						onKeyDown={onEnter}
					/>
				</div>
				<div className="flex flex-[1_1_200px] items-center gap-3">
					<label
						htmlFor="date"
						className="lbl"
					>
						Date
					</label>
					<input
						id="date"
						className="tfield flex-1"
						type="date"
						value={form.date}
						onChange={(e) => form.setDate(e.target.value)}
						onKeyDown={onEnter}
					/>
				</div>
				{/* На мобильном кнопка закреплена внизу экрана, на десктопе стоит в строке */}
				<div className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-10 max-sm:border-t max-sm:border-dashed max-sm:border-line max-sm:bg-panel max-sm:px-4 max-sm:pt-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
					<button
						className="tb w-full py-3 text-base font-bold sm:w-auto sm:px-6"
						onClick={onSubmit}
					>
						Enter ↵ Записать
					</button>
				</div>
			</div>
			<p
				className="mt-3 min-h-5 text-bad uppercase"
				role="alert"
			>
				{form.error && `!! ${form.error.replace(/\.$/, '')}`}
			</p>
		</>
	)
}
