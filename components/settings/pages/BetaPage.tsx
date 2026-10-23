'use client'

import { useEffect, useState } from 'react'
import { useTracker } from '../../TrackerProvider'
import { Block } from '../SettingsFrame'
import { OnceReveal, SettingsRow } from '../Kit'

type BetaUser = { id: string; name: string; verified: boolean; createdAt: string; devices: number }
type Item = { id: string; usesTotal: number; usesLeft: number; createdAt: string; expiresAt: string; revoked: boolean }

const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

/** Коды закрытой регистрации (только админ): создать (код показывается один раз), использование, отозвать */
export function BetaPage() {
	const { toast, offline } = useTracker()
	const [items, setItems] = useState<Item[] | null>(null)
	const [users, setUsers] = useState<BetaUser[] | null>(null)
	const [uses, setUses] = useState('1')
	const [days, setDays] = useState('14')
	const [created, setCreated] = useState<{ code: string; expiresAt: string } | null>(null)
	const [busy, setBusy] = useState(false)

	const load = async () => {
		const res = await fetch('/api/admin/signup-codes', { cache: 'no-store' })
		if (!res.ok) return
		const j = (await res.json()) as { items: Item[]; users: BetaUser[] }
		setItems(j.items)
		setUsers(j.users)
	}
	useEffect(() => {
		load().catch(() => (setItems([]), setUsers([])))
	}, [])

	const create = async () => {
		setBusy(true)
		const res = await fetch('/api/admin/signup-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uses: Number(uses), days: Number(days) }) }).catch(() => null)
		setBusy(false)
		const j = (await res?.json().catch(() => null)) as { code?: string; item?: { expiresAt: string }; error?: string } | null
		if (!res?.ok || !j?.code) return toast(j?.error ?? 'Не удалось создать код.')
		setCreated({ code: j.code, expiresAt: j.item!.expiresAt })
		await load()
	}
	const revoke = async (id: string) => {
		const res = await fetch(`/api/admin/signup-codes?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
		if (!res?.ok) return toast('Не удалось отозвать.')
		toast('Код отозван')
		await load()
	}
	const link = created ? `${window.location.origin}/signup?code=${created.code}` : ''
	const state = (c: Item) =>
		c.revoked ? 'отозван' : new Date(c.expiresAt) < new Date() ? 'истёк' : c.usesLeft === 0 ? 'исчерпан' : `до ${day(c.expiresAt)}`
	const live = (c: Item) => !c.revoked && c.usesLeft > 0 && new Date(c.expiresAt) > new Date()

	const withPush = users?.filter((u) => u.devices > 0).length ?? 0

	return (
		<>
			<Block title="Пользователи" note={users ? `${users.length} всего · ${users.filter((u) => u.verified).length} подтвердили email · ${withPush} с уведомлениями` : undefined}>
				{users === null ? (
					<p className="text-muted">…</p>
				) : (
					users.map((u) => (
						<SettingsRow key={u.id} end={<span className={u.devices ? 'uppercase' : 'text-muted uppercase'}>{u.devices ? `увед. · ${u.devices} устр.` : 'без увед.'}</span>}>
							<b>{u.name}</b> <span className="text-muted">// с {day(u.createdAt)}{!u.verified && ' · email не подтверждён'}</span>
						</SettingsRow>
					))
				)}
			</Block>
			<Block title="Новый код" note="регистрация по ссылке /signup?code=…">
				<div className="flex flex-wrap items-center gap-3 uppercase">
					<label htmlFor="beta-uses" className="lbl">Использований</label>
					<input id="beta-uses" className="tfield w-[6ch]" inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value.replace(/\D/g, ''))} />
					<label htmlFor="beta-days" className="lbl">Дней</label>
					<input id="beta-days" className="tfield w-[6ch]" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
					<button className="tb max-sm:h-11 max-sm:w-full" disabled={busy || !!offline || !uses || !days} onClick={() => void create()}>+ Код</button>
				</div>
				{created && <OnceReveal value={link} until={created.expiresAt} note={<>Код: <b className="text-ink">{created.code}</b> — можно ввести вручную на странице регистрации.</>} onHide={() => setCreated(null)} />}
			</Block>
			<Block title="Коды" note="использовано / всего">
				{items === null ? (
					<p className="text-muted">…</p>
				) : items.length === 0 ? (
					<p className="text-muted uppercase">// Кодов нет</p>
				) : (
					items.map((c) => (
						<SettingsRow key={c.id} end={live(c) ? <button className="tb uppercase" onClick={() => void revoke(c.id)}>Отозвать</button> : <span className="text-muted uppercase">{state(c)}</span>}>
							<b>{c.usesTotal - c.usesLeft}/{c.usesTotal}</b> <span className="text-muted">// создан {day(c.createdAt)}{live(c) && ` · ${state(c)}`}</span>
						</SettingsRow>
					))
				)}
			</Block>
		</>
	)
}
