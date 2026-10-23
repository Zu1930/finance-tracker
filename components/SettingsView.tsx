'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ExportButton } from './ImportExport'
import { Currencies } from './settings/Currencies'
import { BaseCurrency } from './settings/BaseCurrency'
import { MyCurrency } from './settings/MyCurrency'
import { ThemeSwitch } from './settings/ThemeSwitch'
import { Account } from './settings/Account'
import { Beta } from './settings/Beta'
import { Family } from './settings/Family'
import { Archive } from './settings/Archive'
import { useTracker } from './TrackerProvider'
import { Notifications } from './settings/Notifications'
import { QuickEntrySwitch, QuickTokens } from './settings/QuickTokens'

/** Настройки: валюты, основная валюта, оформление, данные, аккаунт */
export function SettingsView() {
	const router = useRouter()
	const { data } = useTracker()
	// Назад — туда, откуда пришли; если страницу открыли напрямую, истории нет — на ввод
	const back = () => (window.history.length > 1 ? router.back() : router.push('/'))

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="sec">Настройки</h1>
				<button
					className="tb"
					onClick={back}
				>
					← Назад
				</button>
			</div>
			<Section title="Семья">
				<Family />
			</Section>
			<Section title="Валюты">
				<Currencies />
			</Section>
			<Section title="Основная валюта">
				<BaseCurrency />
			</Section>
			<Section title="Моя валюта">
				<MyCurrency />
			</Section>
			<Section title="Оформление">
				<ThemeSwitch />
			</Section>
			<Section title="Уведомления">
				<Notifications />
			</Section>
			<Section title="Голосовой ввод">
				<QuickEntrySwitch />
			</Section>
			<Section title="Быстрые команды">
				<QuickTokens />
			</Section>
			<Section title="Данные">
				<div className="tgroup">
					<ExportButton />
				</div>
			</Section>
			{data.admin && (
				<Section title="Бета">
					<Beta />
				</Section>
			)}
			<Section title="Архив">
				<Archive />
			</Section>
			<Section title="Аккаунт">
				<Account />
			</Section>
		</>
	)
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="mt-6 border-t border-dashed border-line pt-5">
			<h2 className="sec mb-4">{title}</h2>
			{children}
		</section>
	)
}
