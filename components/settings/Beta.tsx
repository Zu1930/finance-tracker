'use client'

import { useEffect, useState } from 'react'
import { useTracker } from '../TrackerProvider'

type Item = { id: string; usesTotal: number; usesLeft: number; createdAt: string; expiresAt: string; revoked: boolean }

const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

/** Коды закрытой регистрации (только админ): создать (код показывается один раз), использование, отозвать */
export function Beta() {
	const { toast, offline } = useTracker()
	const [items, setItems] = useState<Item[] | null>(null)
	const [uses, setUses] = useState('1')
	const [days, setDays] = useState('14')
	const [created, setCreated] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const load = async () => {
		const res = await fetch('/api/admin/signup-codes', { cache: 'no-store' })
		if (res.ok) setItems(((await res.json()) as { items: Item[] }).items)
	}
	useEffect(() => {
		load().catch(() => setItems([]))
	}, [])

	const create = async () => {
		setBusy(true)
		const res = await fetch('/api/admin/signup-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uses: Number(uses), days: Number(days) }) }).catch(() => null)
		setBusy(false)
		const j = (await res?.json().catch(() => null)) as { code?: string; error?: string } | null
		if (!res?.ok || !j?.code) return toast(j?.error ?? 'Не удалось создать код.')
		setCreated(j.code)
		await load()
	}
	const revoke = async (id: string) => {
		const res = await fetch(`/api/admin/signup-codes?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
		if (!res?.ok) return toast('Не удалось отозвать.')
		toast('Код отозван')
		await load()
	}
	const link = created ? `${window.location.origin}/signup?code=${created}` : ''
	const copy = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text)
			toast('Скопировано')
		} catch {
			toast('Скопируйте вручную')
		}
	}
	const state = (c: Item) =>
		c.revoked ? 'отозван' : new Date(c.expiresAt) < new Date() ? 'истёк' : c.usesLeft === 0 ? 'исчерпан' : `до ${day(c.expiresAt)}`

	return (
		<div className="uppercase">
			<div className="flex flex-wrap items-center gap-3">
				<label htmlFor="beta-uses" className="lbl">Использований</label>
				<input id="beta-uses" className="tfield w-[6ch]" inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value.replace(/\D/g, ''))} />
				<label htmlFor="beta-days" className="lbl">Дней</label>
				<input id="beta-days" className="tfield w-[6ch]" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
				<button className="tb max-sm:h-11 max-sm:w-full" disabled={busy || !!offline || !uses || !days} onClick={() => void create()}>Создать код</button>
			</div>
			{created && (
				<div className="mt-4 border border-warn p-3">
					<p className="font-bold text-warn">!! Код показывается один раз</p>
					<code className="mt-2 block text-lg select-all">{created}</code>
					<code className="mt-1 block break-all normal-case select-all text-muted">{link}</code>
					<div className="mt-2 flex flex-wrap gap-2">
						<button className="tb" onClick={() => void copy(created)}>Копировать код</button>
						<button className="tb" onClick={() => void copy(link)}>Копировать ссылку</button>
						<button className="tb" onClick={() => setCreated(null)}>Скрыть</button>
					</div>
				</div>
			)}
			{items === null ? (
				<p className="mt-3 text-muted">…</p>
			) : items.length === 0 ? (
				<p className="mt-3 text-muted">// Кодов нет</p>
			) : (
				<ul className="mt-3">
					{items.map((c) => (
						<li key={c.id} className="flex flex-wrap items-center gap-x-4 border-b border-dashed border-line2 py-1">
							<b>{c.usesTotal - c.usesLeft}/{c.usesTotal}</b>
							<span className="text-muted">Создан {day(c.createdAt)}</span>
							<span className="text-muted">{state(c)}</span>
							{!c.revoked && c.usesLeft > 0 && new Date(c.expiresAt) > new Date() && (
								<button className="tb ml-auto" onClick={() => void revoke(c.id)}>Отозвать</button>
							)}
						</li>
					))}
				</ul>
			)}
			<p className="mt-3 text-muted2">// Регистрация по коду: /signup?code=… Использовано / всего</p>
		</div>
	)
}
