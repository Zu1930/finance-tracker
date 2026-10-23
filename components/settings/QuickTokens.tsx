'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTracker } from '../TrackerProvider'
import { OnceReveal, SettingsRow } from './Kit'

type Item = { id: string; name: string; createdAt: string; lastUsedAt: string | null }

const ddmm = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

/** Показывать ли строку голосового ввода на странице ввода — мне, на всех моих устройствах */
export function QuickEntrySwitch() {
	const { data, setMySettings } = useTracker()
	const hidden = !!data.mySettings.hideQuickEntry
	const set = (hide: boolean) =>
		setMySettings(({ version: _, hideQuickEntry: __, ...rest }) => ({ ...rest, ...(hide ? { hideQuickEntry: true } : {}) }))
	return (
		<div className="tgroup uppercase" role="group" aria-label="Строка голосового ввода">
			<button className="tb" aria-pressed={!hidden} onClick={() => set(false)}>Показывать</button>
			<button className="tb" aria-pressed={hidden} onClick={() => set(true)}>Скрыть</button>
		</div>
	)
}

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
	return (
		<div>
			{items === null ? (
				<p className="text-muted">…</p>
			) : items.length === 0 ? (
				<p className="text-muted uppercase">// Токенов нет</p>
			) : (
				items.map((t) => (
					<SettingsRow key={t.id} end={<button className="tb uppercase" onClick={() => void revoke(t.id)}>Отозвать</button>}>
						{t.name} <span className="text-muted">// {t.lastUsedAt ? `использован ${ddmm(t.lastUsedAt)}` : `создан ${ddmm(t.createdAt)}, ещё не использован`}</span>
					</SettingsRow>
				))
			)}
			{created && <OnceReveal value={created} note="Вставьте токен в Быструю команду. Потом его не увидеть — только отозвать и создать новый." onHide={() => setCreated(null)} />}
			<div className="mt-3 flex flex-wrap items-center gap-3 uppercase">
				<label htmlFor="token-name" className="lbl">Устройство</label>
				<input id="token-name" className="tfield w-[16ch] normal-case max-sm:flex-1" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
				<button className="tb max-sm:h-11 max-sm:w-full" disabled={busy || !!offline || !name.trim()} onClick={() => void create()}>+ Токен</button>
				<Link href="/settings/input/siri" className="tb max-sm:h-11 max-sm:w-full sm:ml-auto">Как настроить →</Link>
			</div>
		</div>
	)
}
