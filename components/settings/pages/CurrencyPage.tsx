'use client'

import { useTracker } from '../../TrackerProvider'
import { Block } from '../SettingsFrame'
import { MyCurrency } from '../MyCurrency'
import { Currencies } from '../Currencies'
import { BaseCurrency } from '../BaseCurrency'

const ddmm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

/** Валюты: моя (в solo — только если валют больше одной), валюты бюджета с курсами, смена основной (свёрнута) */
export function CurrencyPage() {
	const { data, isSolo } = useTracker()
	const st = data.settings!
	return (
		<>
			{(!isSolo || st.currencies.length > 1) && (
				<Block title="Моя валюта">
					<MyCurrency />
				</Block>
			)}
			<Block title="Валюты бюджета" note={st.ratesUpdatedAt ? `курсы на ${ddmm(st.ratesUpdatedAt)}` : undefined}>
				<Currencies />
			</Block>
			<Block title="Основная валюта">
				<BaseCurrency />
			</Block>
		</>
	)
}
