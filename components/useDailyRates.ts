'use client'

import { useEffect, useRef } from 'react'
import { useTracker } from './TrackerProvider'
import { todayStr } from '@/lib/utils'

/**
 * Раз в день подтягивает курсы валют ввода из /api/rates и сохраняет их в settings.rates.
 * Ручной курс, введённый при записи траты, действует до следующего обновления.
 * Ошибка сервиса не мешает работе: остаются прежние курсы.
 */
export function useDailyRates() {
	const { status, data, updateRates } = useTracker()
	const st = data.settings
	// Одна попытка на набор «день + база + валюты» за сессию, чтобы не долбить API при ошибке
	const tried = useRef('')

	useEffect(() => {
		if (status !== 'ready' || !st) return
		const symbols = st.currencies.filter((c) => c !== st.base)
		if (symbols.length === 0) return
		const today = todayStr()
		const stale =
			st.ratesUpdatedAt !== today || symbols.some((c) => st.rates[c] == null)
		const key = `${today}|${st.base}|${symbols.join(',')}`
		if (!stale || tried.current === key) return
		tried.current = key

		const base = st.base
		fetch(`/api/rates?base=${base}&symbols=${symbols.join(',')}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((json: { rates: Record<string, number> } | null) => {
				if (!json) return
				// Пока ждали ответ, базу могли сменить — тогда курсы уже не к той валюте
				updateRates(json.rates, today, base)
			})
			.catch(() => {})
	}, [status, st, updateRates])
}
