'use client'

import { Block } from '../SettingsFrame'
import { QuickEntrySwitch, QuickTokens } from '../QuickTokens'

/** Голос и Siri: строка «● Голос» на вводе и токены Быстрых команд */
export function InputPage() {
	return (
		<>
			<Block title="Строка «● Голос» на вводе">
				<QuickEntrySwitch />
			</Block>
			<Block title="Siri" note="работает, даже если строка скрыта">
				<QuickTokens />
			</Block>
		</>
	)
}
