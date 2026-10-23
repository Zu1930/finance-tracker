'use client'

import { Block } from '../SettingsFrame'
import { Archive } from '../Archive'

/** Данные: экспорт всего своего (JSON) и трат (CSV), архивы бывших семей */
export function DataPage() {
	return (
		<>
			<Block title="Экспорт">
				<div className="flex flex-wrap gap-3 uppercase">
					<a href="/api/account/export" className="tb max-sm:h-11 max-sm:w-full">Скачать JSON</a>
					<a href="/api/account/export?format=csv" className="tb max-sm:h-11 max-sm:w-full">CSV трат</a>
				</div>
				<p className="mt-2 text-xs text-muted2">JSON — всё, что вы видите: профиль, бюджет, архивы. CSV — траты и доходы бюджета таблицей.</p>
			</Block>
			<Block title="Архив">
				<Archive />
			</Block>
		</>
	)
}
