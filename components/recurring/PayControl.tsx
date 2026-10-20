'use client'

import { useState, type KeyboardEvent } from 'react'
import type { Row } from './useRecurring'
import { amountChars, fmt, parseAmount } from '@/lib/utils'

/**
 * [ ОПЛАЧЕНО ]: точный платёж записывается сразу, примерный открывает поле с оценкой и [ OK ]
 * (Enter — подтвердить, Esc — отменить). Открытое поле занимает всю строку (col-span-full в сетке строки)
 */
export function PayControl({ row, pay, big = false }: { row: Row; pay: (amount?: number) => void; big?: boolean }) {
	const [open, setOpen] = useState(false)
	const [val, setVal] = useState('')
	const overdue = row.status === 'overdue'
	const btn = `tb ${big ? 'h-11 sm:h-auto' : ''} ${overdue ? 'border-ink bg-ink font-bold text-panel hover:bg-ink' : ''}`

	if (!open)
		return (
			<button
				className={btn}
				aria-label={`Оплачено: ${row.name}`}
				onClick={() => {
					if (!row.approx) return pay()
					setVal(String(row.amount))
					setOpen(true)
				}}
			>
				Оплачено
			</button>
		)
	const ok = () => {
		const n = parseAmount(val)
		if (!n || !(n > 0)) return
		pay(n)
		setOpen(false)
	}
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Enter') ok()
		if (e.key === 'Escape') setOpen(false)
	}
	return (
		<div className="col-span-full flex basis-full items-center gap-3 max-sm:w-full sm:basis-auto">
			<input
				autoFocus
				className="tfield min-w-0 flex-1 text-right sm:w-[12ch] sm:flex-none"
				inputMode="decimal"
				aria-label={`Сумма оплаты: ${row.name}`}
				value={val}
				onChange={(e) => setVal(amountChars(e.target.value))}
				onKeyDown={onKey}
			/>
			<span className="text-muted">{row.currency}</span>
			<button className="tb" onClick={ok}>OK</button>
			<span className="text-muted2 max-sm:hidden">// оценка {fmt(row.amount)}</span>
		</div>
	)
}
