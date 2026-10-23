'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTracker } from '../TrackerProvider'

type Item = {
	householdId: string; name: string; dissolved: boolean; joinedAt: string; leftAt: string; until: string
	reviewed: boolean; restore: { requested: boolean; waiting: string[]; askedBy: string[] } | null
}
const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

/** :: АРХИВ — бывшие семьи: период, срок доступа, просмотр, экспорт, разбор, восстановление */
export function Archive() {
	const { toast, reload } = useTracker()
	const [items, setItems] = useState<Item[] | null>(null)
	const load = async () => {
		const res = await fetch('/api/archive', { cache: 'no-store' })
		if (res.ok) setItems(((await res.json()) as { items: Item[] }).items)
	}
	useEffect(() => {
		load().catch(() => setItems([]))
	}, [])

	const restore = async (id: string) => {
		const res = await fetch(`/api/archive/${id}/restore`, { method: 'POST' }).catch(() => null)
		const j = (await res?.json().catch(() => null)) as { restored?: boolean; kept?: { names: string[] }[]; error?: string } | null
		if (!res?.ok) return toast(j?.error ?? 'Не удалось.')
		if (!j?.restored) toast('Запрос отправлен: бюджет восстановится, когда согласятся все')
		else {
			const kept = (j.kept ?? []).flatMap((k) => k.names)
			toast(kept.length ? `Общий бюджет восстановлен. Остались личными изменённые копии: ${kept.join(', ')}` : 'Общий бюджет восстановлен')
			await reload(true)
		}
		await load()
	}

	if (items === null) return <p className="text-muted">…</p>
	if (items.length === 0) return <p className="text-muted2">Здесь появятся бюджеты, из которых вы вышли. Хранятся 90 дней.</p>
	return (
		<ul className="uppercase">
			{items.map((a) => (
				<li key={a.householdId} className="border-b border-dashed border-line2 py-2">
					<div className="flex flex-wrap items-baseline gap-x-4">
						<b className="normal-case">{a.dissolved ? 'Общий бюджет' : 'Семья'}</b>
						<span className="text-muted">{day(a.joinedAt)} — {day(a.leftAt)}</span>
						<span className="text-warn">Доступен до {new Date(a.until).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span>
					</div>
					<div className="mt-2 flex flex-wrap gap-2">
						<Link href={`/archive/${a.householdId}`} className="tb">Открыть</Link>
						<a href={`/api/archive/${a.householdId}/export?format=json`} className="tb">JSON</a>
						<a href={`/api/archive/${a.householdId}/export?format=csv`} className="tb">CSV</a>
						<Link href={`/review/${a.householdId}`} className="tb">Вернуться к разбору</Link>
						{a.restore && !a.restore.requested && <button className="tb" onClick={() => void restore(a.householdId)}>Восстановить общий бюджет</button>}
					</div>
					{a.restore && !a.restore.requested && a.restore.askedBy.length > 0 && <p className="mt-1 text-warn">&gt; {a.restore.askedBy.join(', ')} просит восстановить общий бюджет</p>}
					{a.restore?.requested && <p className="mt-1 text-muted2">// Вы попросили восстановить. Ждём: {a.restore.waiting.join(', ') || '—'}</p>}
				</li>
			))}
		</ul>
	)
}
