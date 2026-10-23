'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useTracker } from '../TrackerProvider'
import { HINTS, HINT_QUIET_MS, visibleHint, type HintId } from '@/lib/onboarding'

type Slot = { active: HintId | null; register: (id: HintId) => () => void }
const HintSlot = createContext<Slot>({ active: null, register: () => () => {} })

/**
 * Одна подсказка на экране: подсказки регистрируются по мере появления, видна первая ещё не виденная.
 * Первые 10 секунд после опроса — ни одной
 */
export function HintsProvider({ children }: { children: ReactNode }) {
	const { data, isSolo } = useTracker()
	const [wanted, setWanted] = useState<HintId[]>([])
	const [now, setNow] = useState(() => Date.now())
	const ob = data.onboarding
	const quietLeft = ob?.completedAt ? Date.parse(ob.completedAt) + HINT_QUIET_MS - now : 0
	useEffect(() => {
		if (quietLeft <= 0) return
		const t = setTimeout(() => setNow(Date.now()), quietLeft + 50)
		return () => clearTimeout(t)
	}, [quietLeft])

	const active = ob && ob.status !== 'pending' && !data.readonly ? visibleHint(wanted, ob, isSolo, now) : null
	const [slot] = useState<Pick<Slot, 'register'>>(() => ({
		register: (id) => {
			setWanted((w) => (w.includes(id) ? w : [...w, id]))
			return () => setWanted((w) => w.filter((x) => x !== id))
		},
	}))
	return <HintSlot.Provider value={{ active, register: slot.register }}>{children}</HintSlot.Provider>
}

/** Подсказка по месту: один раз на пользователя. × или «Подробнее» — больше не показывается */
export function Hint({ id, className = '' }: { id: HintId; className?: string }) {
	const { active, register } = useContext(HintSlot)
	const { patchOnboarding } = useTracker()
	useEffect(() => register(id), [id, register])
	if (active !== id) return null
	const seen = () => patchOnboarding({ hint: id })
	const h = HINTS[id]
	return (
		<aside className={`flex items-start gap-3 border-l-2 border-ink py-1 pl-3 ${className}`} aria-label="Подсказка">
			<p className="min-w-0 flex-1 text-muted">
				<span aria-hidden="true">› </span>
				{h.text}{' '}
				<Link href={h.href} className="whitespace-nowrap text-ink uppercase underline-offset-4 hover:underline" onClick={seen}>Подробнее →</Link>
			</p>
			<button className="xb -my-2" aria-label="Скрыть подсказку" onClick={seen}>×</button>
		</aside>
	)
}
