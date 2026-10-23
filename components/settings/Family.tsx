'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTracker } from '../TrackerProvider'

type Info = {
	kind: 'solo' | 'family'
	members: { id: string; name: string; role: 'owner' | 'member'; joinedAt: string }[]
	invites: { id: string; createdAt: string; expiresAt: string; createdBy: string }[]
}

const MAX_MEMBERS = 6
const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

/** :: СЕМЬЯ — solo: пригласить; семья: участники, приглашения, выход */
export function Family() {
	const { toast, offline } = useTracker()
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
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(link!.url)
			toast('Скопировано')
		} catch {
			toast('Скопируйте вручную')
		}
	}

	if (!info) return <p className="text-muted">…</p>
	const family = info.kind === 'family'
	const canInvite = info.members.length + info.invites.length < MAX_MEMBERS

	return (
		<div className="uppercase">
			{family ? (
				<ul>
					{info.members.map((m) => (
						<li key={m.id} className="flex flex-wrap items-center gap-x-4 border-b border-dashed border-line2 py-1">
							<b className="normal-case">{m.name}</b>
							<span className="text-muted">с {day(m.joinedAt)}</span>
						</li>
					))}
				</ul>
			) : (
				<p className="text-muted2">// Бюджет только ваш. Пригласите человека — бюджет станет общим, ваши данные останутся личными</p>
			)}

			{info.invites.length > 0 && (
				<>
					<h3 className="mt-4 text-muted">Приглашения</h3>
					<ul className="mt-1">
						{info.invites.map((i) => (
							<li key={i.id} className="flex flex-wrap items-center gap-x-4 border-b border-dashed border-line2 py-1">
								<span className="normal-case">{i.createdBy}</span>
								<span className="text-muted">до {day(i.expiresAt)}</span>
								<button className="tb ml-auto" disabled={!!offline} onClick={() => void revoke(i.id)}>Отозвать</button>
							</li>
						))}
					</ul>
				</>
			)}

			{link && (
				<div className="mt-4 border border-warn p-3">
					<p className="font-bold text-warn">!! Ссылка показывается один раз, действует до {day(link.expiresAt)}</p>
					<code className="mt-2 block break-all normal-case select-all">{link.url}</code>
					<p className="mt-1 text-muted2">// Одноразовая: по ней может войти один человек</p>
					<div className="mt-2 flex gap-2">
						<button className="tb" onClick={() => void copy()}>Копировать</button>
						<button className="tb" onClick={() => setLink(null)}>Скрыть</button>
					</div>
				</div>
			)}

			<div className="mt-4 flex flex-wrap gap-3">
				<button className="tb max-sm:h-12 max-sm:w-full" disabled={busy || !!offline || !canInvite} onClick={() => void invite()}>Пригласить</button>
				{family && <Link href="/leave" className="tb max-sm:h-12 max-sm:w-full">Выйти из семьи</Link>}
			</div>
			{!canInvite && <p className="mt-2 text-muted2">// В семье может быть не больше {MAX_MEMBERS} участников вместе с приглашёнными</p>}
		</div>
	)
}
