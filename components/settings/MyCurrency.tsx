'use client'

import { useTracker } from '../TrackerProvider'

/** Моя валюта по умолчанию для личных трат и доходов. Видна только мне; семейные траты — в общей валюте */
export function MyCurrency() {
	const { data, setMySettings } = useTracker()
	const st = data.settings!
	const mine = data.mySettings.preferredCurrency
	const current = mine && st.currencies.includes(mine) ? mine : st.base

	return (
		<div>
			<div
				className="tgroup"
				role="group"
				aria-label="Моя валюта для личных трат и доходов"
			>
				{st.currencies.map((c) => (
					<button
						key={c}
						className="tb tb-tight"
						aria-pressed={current === c}
						onClick={() => setMySettings((s) => ({ ...s, preferredCurrency: c }))}
					>
						{c}
					</button>
				))}
			</div>
			<p className="mt-2 text-xs text-muted2">{data.solo ? 'Для всех трат и доходов.' : `Для личных трат и доходов. Семейные — в ${st.base}.`}</p>
		</div>
	)
}
