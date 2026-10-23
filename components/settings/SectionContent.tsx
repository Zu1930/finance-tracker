'use client'

import type { Section } from '@/lib/settings-meta'
import { SectionPage } from './SettingsFrame'
import { FamilyPage } from './pages/FamilyPage'
import { CurrencyPage } from './pages/CurrencyPage'
import { InputPage } from './pages/InputPage'
import { DevicePage } from './pages/DevicePage'
import { DataPage } from './pages/DataPage'
import { AccountPage } from './pages/AccountPage'
import { BetaPage } from './pages/BetaPage'

const PAGES: Record<Section, () => React.ReactNode> = {
	family: FamilyPage, currency: CurrencyPage, input: InputPage, device: DevicePage, data: DataPage, account: AccountPage, beta: BetaPage,
}

export function SectionContent({ section }: { section: Section }) {
	const Page = PAGES[section]
	return (
		<SectionPage section={section}>
			<Page />
		</SectionPage>
	)
}
