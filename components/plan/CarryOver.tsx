'use client'

import { useEffect, useState } from 'react'
import { useTracker } from '../TrackerProvider'
import { usePlan } from './usePlan'
import { MONTHS_IN, curMonthKey, shiftMonth } from '@/lib/utils'

const HIDDEN_KEY = 'ft:carry-hidden'

/**
 * НЕВЫПОЛНЕНО В ОКТЯБРЕ: N — пункты прошлого месяца без единой связанной траты (partial не переносятся).
 * [×] прячет строку до следующего месяца: в localStorage запоминается текущий месяц
 */
export function CarryOver() {
	const { api, toast } = useTracker()
	const cur = curMonthKey()
	const prev = shiftMonth(cur, -1)
	const { items, linked } = usePlan(prev)
	const left = items.filter((i) => !(linked[i.id] > 0) && i.expenseIds.length === 0)
	// localStorage недоступен при серверном рендере — читаем после монтирования
	const [hidden, setHidden] = useState(true)
	useEffect(() => {
		try { setHidden(localStorage.getItem(HIDDEN_KEY) === cur) } catch { setHidden(false) }
	}, [cur])
	if (hidden || left.length === 0) return null

	const hide = () => {
		try { localStorage.setItem(HIDDEN_KEY, cur) } catch {}
		setHidden(true)
	}
	const moveAll = async () => {
		let n = 0
		for (const i of left) if (await api(`/api/plan-items/${i.id}`, 'PATCH', { scope: i.scope, month: i.month, version: i.version, toMonth: cur })) n++
		toast(`Перенесено: ${n}`)
	}
	const removeAll = async () => {
		let n = 0
		for (const i of left) if (await api(`/api/plan-items/${i.id}?scope=${i.scope}&month=${i.month}`, 'DELETE')) n++
		toast(`Удалено: ${n}`)
	}

	return (
		<div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border border-dashed border-line2 px-3 py-1 uppercase">
			<span className="flex-1">Невыполнено в {MONTHS_IN[Number(prev.slice(5)) - 1]}: <b>{left.length}</b></span>
			<button className="tb" onClick={() => void moveAll()}>Перенести всё</button>
			<button className="tb" onClick={() => void removeAll()}>Удалить</button>
			<button className="xb -mr-2" aria-label="Скрыть до следующего месяца" onClick={hide}>×</button>
		</div>
	)
}
