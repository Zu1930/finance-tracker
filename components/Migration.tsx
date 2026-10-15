'use client'

import { useState } from 'react'
import { useTracker } from './TrackerProvider'
import { downloadJson } from './ImportExport'
import { todayStr } from '@/lib/utils'

/** Перенос старых данных в семейный формат: показывается вместо первой настройки, пока перенос не сделан */
export function Migration() {
	const { data, reload } = useTracker()
	const owner = data.migration!.owner
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	if (owner.id !== data.me.id) {
		return (
			<section className="max-w-[60ch]">
				<h1 className="sec">Миграция</h1>
				<p className="mt-4 text-muted uppercase">
					Данные ещё в старом формате. Перенос запускает {owner.name}.
				</p>
			</section>
		)
	}

	const run = async () => {
		setBusy(true)
		setError(null)
		try {
			// Резервная копия старых данных до переноса
			const backup = await fetch('/api/migrate-v2')
			if (!backup.ok) throw new Error(((await backup.json().catch(() => ({}))) as { error?: string }).error ?? '')
			downloadJson(await backup.json(), `traty-backup-before-family-${todayStr()}.json`)
			const ok = window.confirm(
				'Все записи станут семейными, автор — ' + owner.name + '. Резервная копия скачана. Продолжить?'
			)
			if (!ok) return
			const res = await fetch('/api/migrate-v2', { method: 'POST' })
			if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? '')
			await reload(true)
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<section className="max-w-[60ch]">
			<h1 className="sec">Миграция</h1>
			<p className="mt-4 text-muted">
				Старые категории станут семейными, траты и доходы — семейными с автором {owner.name}. Личные
				категории у обоих пустые. Старые данные останутся в хранилище резервной копией.
			</p>
			<button
				className="tb mt-6 font-bold"
				disabled={busy}
				onClick={run}
			>
				{busy ? 'Перенос…' : 'Перенести данные в семейный формат'}
			</button>
			<p
				className="mt-3 min-h-5 text-bad uppercase"
				role="alert"
			>
				{error !== null && `!! Перенос не выполнен${error ? ` // ${error.replace(/\.$/, '')}` : ''}`}
			</p>
		</section>
	)
}
