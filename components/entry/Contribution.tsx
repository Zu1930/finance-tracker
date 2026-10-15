'use client'

import { useTracker } from '../TrackerProvider'
import { fmt } from '@/lib/utils'

/** «ВЛАД 18 400 · МАША 12 800» — суммы по авторам */
export function Contribution({ sums, sign = '' }: { sums: Record<string, number>; sign?: string }) {
	const { data } = useTracker()
	return (
		<span className="text-muted uppercase">
			{[data.me, data.partner].map((u, i) => (
				<span key={u.id}>
					{i > 0 && ' · '}
					{u.name} {sign}
					{fmt(sums[u.id] ?? 0)}
				</span>
			))}
		</span>
	)
}
