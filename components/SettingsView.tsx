'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ExportButton, ImportButton } from './ImportExport'
import { Currencies } from './settings/Currencies'
import { BaseCurrency } from './settings/BaseCurrency'
import { ThemeSwitch } from './settings/ThemeSwitch'
import { HoldLogout } from './settings/HoldLogout'

/** Настройки: валюты, основная валюта, оформление, данные, аккаунт */
export function SettingsView() {
	const router = useRouter()
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
			<Section title="Валюты">
				<Currencies />
			</Section>
			<Section title="Основная валюта">
				<BaseCurrency />
			</Section>
			<Section title="Оформление">
				<ThemeSwitch />
			</Section>
			<Section title="Данные">
				<div className="flex flex-wrap gap-2">
					<ExportButton />
					<ImportButton />
				</div>
			</Section>
			<Section title="Аккаунт">
				<HoldLogout />
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
