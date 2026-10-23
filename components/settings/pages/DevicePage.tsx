'use client'

import { Block } from '../SettingsFrame'
import { ThemeSwitch } from '../ThemeSwitch'
import { Notifications } from '../Notifications'

/** Это устройство: тема и уведомления — только в этом браузере */
export function DevicePage() {
	return (
		<>
			<p className="mt-2 text-muted2">Настройки ниже действуют только в этом браузере.</p>
			<Block title="Тема">
				<ThemeSwitch />
			</Block>
			<Block title="Уведомления">
				<Notifications />
			</Block>
		</>
	)
}
