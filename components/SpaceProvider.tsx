'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTracker } from './TrackerProvider'
import { SPACE_IDS, readSpace, spaceData, writeSpace, type Space } from '@/lib/space'
import type { Scope } from '@/lib/types'

export type SpaceCtx = {
	/** Выбранный бюджет; у solo и в архиве — переключателя нет */
	space: Space
	setSpace: (s: Space) => void
	/** Чем фильтровать данные: solo и архив — всё (у solo семейного нет) */
	view: Space
	/** «Всё вместе»: никаких действий создания и изменения */
	readOnly: boolean
	/** Есть ли выбор бюджета (семья, не архив) */
	switchable: boolean
	/** Куда пишет новая запись; null — в «всё вместе» писать нельзя */
	entryScope: Scope | null
	chooserOpen: boolean
	setChooserOpen: (open: boolean) => void
}

/** Без провайдера (компонентные тесты, архив без Shell) — всё вместе, но действия не прячутся */
const FALLBACK: SpaceCtx = { space: 'all', setSpace: () => {}, view: 'all', readOnly: false, switchable: false, entryScope: 'personal', chooserOpen: false, setChooserOpen: () => {} }

/** Экспорт — для компонентных тестов */
export const SpaceContext = createContext<SpaceCtx>(FALLBACK)
export const useSpace = () => useContext(SpaceContext)

/** Данные выбранного бюджета для метрик и графика */
export function useSpaceData() {
	const { data } = useTracker()
	const { view } = useSpace()
	return useMemo(() => spaceData(data, view), [data, view])
}

/** Поле ввода в фокусе — горячие клавиши бюджета не перехватываем */
export const inField = (el: Element | null) => !!(el as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')

export function SpaceProvider({ children }: { children: ReactNode }) {
	const { data, isSolo } = useTracker()
	const userId = data.me.id
	const [space, setState] = useState<Space>('family')
	const [chooserOpen, setChooserOpen] = useState(false)
	useEffect(() => {
		if (userId) setState(readSpace(userId))
	}, [userId])
	const setSpace = useCallback((s: Space) => {
		setState(s)
		if (userId) writeSpace(userId, s)
	}, [userId])

	const switchable = !isSolo && !data.readonly
	// Alt + 1 / 2 / 3 — семья, личное, всё вместе (e.code: на macOS Alt меняет e.key)
	useEffect(() => {
		if (!switchable) return
		const onKey = (e: KeyboardEvent) => {
			const n = /^Digit([1-3])$/.exec(e.code)?.[1]
			if (!e.altKey || e.ctrlKey || e.metaKey || !n || inField(document.activeElement)) return
			e.preventDefault()
			setSpace(SPACE_IDS[Number(n) - 1])
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [switchable, setSpace])

	const value = useMemo<SpaceCtx>(() => {
		if (!switchable) return { ...FALLBACK, readOnly: !!data.readonly, entryScope: data.readonly ? null : 'personal', chooserOpen, setChooserOpen }
		return { space, setSpace, view: space, readOnly: space === 'all', switchable, entryScope: space === 'all' ? null : space, chooserOpen, setChooserOpen }
	}, [switchable, data.readonly, space, setSpace, chooserOpen])

	return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>
}
