'use client'

import { useEffect, useState } from 'react'
import { useTracker } from '../../TrackerProvider'
import { Block } from '../SettingsFrame'
import { DangerZone, OnceReveal, SettingsRow } from '../Kit'

type Info = {
	kind: 'solo' | 'family'
	members: { id: string; name: string; role: 'owner' | 'member'; joinedAt: string }[]
	invites: { id: string; createdAt: string; expiresAt: string; createdBy: string }[]
}

const MAX_MEMBERS = 6
const ddmmyy = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
const ddmm = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

/** Семья: участники, приглашения (ссылка — один раз), выход */
export function FamilyPage() {
	const { data, toast, offline } = useTracker()
	const [info, setInfo] = useState<Info | null>(null)
	const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)
	const [busy, setBusy] = useState(false)

	const load = async () => {
		const res = await fetch('/api/family', { cache: 'no-store' })
		if (res.ok) setInfo((await res.json()) as Info)
	}
	useEffect(() => {
		load().catch(() => {})
	}, [])

	const invite = async () => {
		setBusy(true)
		const res = await fetch('/api/family/invites', { method: 'POST' }).catch(() => null)
		setBusy(false)
		const j = (await res?.json().catch(() => null)) as { code?: string; invite?: { expiresAt: string }; error?: string } | null
		if (!res?.ok || !j?.code) return toast(j?.error ?? 'Не удалось создать приглашение.')
		setLink({ url: `${window.location.origin}/join/${j.code}`, expiresAt: j.invite!.expiresAt })
		await load()
	}
	const revoke = async (id: string) => {
		const res = await fetch(`/api/family/invites?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
		if (!res?.ok) return toast('Не удалось отозвать.')
		toast('Приглашение отозвано')
		await load()
	}

	if (!info) return <p className="mt-7 text-muted">…</p>
	const family = info.kind === 'family'
	const canInvite = info.members.length + info.invites.length < MAX_MEMBERS

	return (
		<>
			<Block title="Участники">
				{family ? (
					info.members.map((m) => (
						<SettingsRow key={m.id} end={<span className="text-muted uppercase">с {ddmmyy(m.joinedAt)}</span>}>
							<b>{m.name}</b>
							{m.id === data.me.id && <span className="text-muted"> // вы</span>}
						</SettingsRow>
					))
				) : (
					<p className="uppercase">Бюджет только ваш</p>
				)}
			</Block>

			<Block title="Приглашения">
				{info.invites.map((i) => (
					<SettingsRow key={i.id} end={<button className="tb uppercase" disabled={!!offline} onClick={() => void revoke(i.id)}>Отозвать</button>}>
						Ссылка от {i.createdBy} <span className="text-muted">// до {ddmm(i.expiresAt)}</span>
					</SettingsRow>
				))}
				{link && (
					<OnceReveal value={link.url} until={link.expiresAt} note="Одноразовая: по ней войдёт один человек. Ваши данные останутся личными." onHide={() => setLink(null)} />
				)}
				<div className="mt-3 flex flex-wrap items-center gap-3 uppercase">
					<button className="tb max-sm:h-11 max-sm:w-full" disabled={busy || !!offline || !canInvite} onClick={() => void invite()}>+ Пригласить</button>
					<span className="text-xs text-muted2">// до {MAX_MEMBERS} участников{!canInvite && ' — мест нет'}</span>
				</div>
			</Block>

			{family && (
				<DangerZone title="Выход из семьи" action="Выйти из семьи…" href="/leave">
					Личное останется у вас, общее уйдёт в архив на 90 дней.
				</DangerZone>
			)}
		</>
	)
}
