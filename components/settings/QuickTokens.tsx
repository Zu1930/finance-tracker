'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTracker } from '../TrackerProvider'

type Item = { id: string; name: string; createdAt: string; lastUsedAt: string | null }

const when = (iso: string | null) =>
	iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

/** Токены для Siri / Быстрых команд: создать (показывается один раз), список, отозвать */
export function QuickTokens() {
	const { toast, offline } = useTracker()
	const [items, setItems] = useState<Item[] | null>(null)
	const [name, setName] = useState('iPhone')
	const [created, setCreated] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const load = async () => {
		const res = await fetch('/api/quick/tokens', { cache: 'no-store' })
		if (res.ok) setItems(((await res.json()) as { items: Item[] }).items)
	}
	useEffect(() => {
		load().catch(() => setItems([]))
	}, [])

	const create = async () => {
		setBusy(true)
		try {
			const res = await fetch('/api/quick/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
			const j = (await res.json()) as { token?: string; error?: string }
			if (!res.ok || !j.token) return toast(j.error ?? 'Не удалось создать токен.')
			setCreated(j.token)
			await load()
		} catch {
			toast('Не удалось создать токен.')
		} finally {
			setBusy(false)
		}
	}
	const revoke = async (id: string) => {
		const res = await fetch(`/api/quick/tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
		if (!res?.ok) return toast('Не удалось отозвать.')
		toast('Токен отозван')
		await load()
	}
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(created!)
			toast('Скопировано')
		} catch {
			toast('Скопируйте вручную')
		}
	}

	return (
		<div className="uppercase">
			<div className="flex flex-wrap items-center gap-3">
				<label htmlFor="token-name" className="lbl">Устройство</label>
				<input id="token-name" className="tfield w-[16ch] normal-case max-sm:flex-1" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
				<button className="tb max-sm:w-full max-sm:h-11" disabled={busy || !!offline || !name.trim()} onClick={() => void create()}>
					Создать токен
				</button>
			</div>
			{created && (
				<div className="mt-4 border border-warn p-3">
					<p className="font-bold text-warn">!! Токен показывается один раз</p>
					<code className="mt-2 block break-all normal-case select-all">{created}</code>
					<div className="mt-2 flex gap-2">
						<button className="tb" onClick={() => void copy()}>Копировать</button>
						<button className="tb" onClick={() => setCreated(null)}>Скрыть</button>
					</div>
				</div>
			)}
			{items === null ? (
				<p className="mt-3 text-muted">…</p>
			) : items.length === 0 ? (
				<p className="mt-3 text-muted">// Токенов нет</p>
			) : (
				<ul className="mt-3">
					{items.map((t) => (
						<li key={t.id} className="flex flex-wrap items-center gap-x-4 border-b border-dashed border-line2 py-1">
							<b className="normal-case">{t.name}</b>
							<span className="text-muted">Создан {when(t.createdAt)}</span>
							<span className="text-muted">Использован {when(t.lastUsedAt)}</span>
							<button className="tb ml-auto" onClick={() => void revoke(t.id)}>Отозвать</button>
						</li>
					))}
				</ul>
			)}
			<p className="mt-3">
				<Link href="/settings/siri" className="tb">Как настроить Siri</Link>
			</p>
		</div>
	)
}
