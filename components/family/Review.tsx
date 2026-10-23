'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fmt } from '@/lib/utils'

type ReviewView = {
	householdId: string; name: string; dissolved: boolean
	accounts: { id: string; name: string; currency: string; balance: number; claimedBy: string | null; mine: boolean }[]
	goals: { id: string; name: string; currency: string; target: number; allocated: number }[]
	recurring: { id: string; name: string; currency: string; amount: number; claimedBy: string | null; mine: boolean }[]
	categories: string[]
}

/** Разбор семейного имущества: у каждого свой, шаги можно пропустить и вернуться из архива, пока он существует */
export function Review({ householdId }: { householdId: string }) {
	const [v, setV] = useState<ReviewView | null>(null)
	const [note, setNote] = useState('')
	const [busy, setBusy] = useState(false)
	const [copied, setCopied] = useState<Set<string>>(new Set())
	const url = `/api/archive/${encodeURIComponent(householdId)}/review`

	const load = async () => {
		const res = await fetch(url, { cache: 'no-store' })
		if (res.ok) setV((await res.json()) as ReviewView)
		else setNote(res.status === 404 ? '!! Архив недоступен' : '!! Не удалось загрузить')
	}
	useEffect(() => {
		load().catch(() => setNote('!! Сервер недоступен'))
	}, [])

	const step = async (action: string, id?: string, done?: string) => {
		setBusy(true)
		const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }) }).catch(() => null)
		const j = (await res?.json().catch(() => null)) as { error?: string; added?: number } | null
		setBusy(false)
		if (!res?.ok) return setNote(`!! ${(j?.error ?? 'Не удалось').replace(/\.$/, '')}`)
		if (action === 'done') return void (window.location.href = '/')
		setNote(`> ${action === 'copy-categories' ? `Скопировано категорий: ${j?.added ?? 0}` : done}`)
		if (id) setCopied((s) => new Set([...s, `${action}:${id}`]))
		await load()
	}

	const Row = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
		<li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-dashed border-line2 py-2">
			<b className="normal-case">{title}</b>
			<span className="text-muted">{sub}</span>
			<span className="ml-auto">{children}</span>
		</li>
	)
	const Claimed = ({ by, mine }: { by: string | null; mine: boolean }) => <span className="text-muted">{mine ? 'Забрано к вам' : `Забрал(а) ${by}`}</span>

	return (
		<div className="px-4">
			<div className="mx-auto mt-[6vh] max-w-2xl pb-16 uppercase">
				<h1 className="sec">{v?.dissolved === false ? 'Разбор семейного имущества' : 'Общий бюджет больше не активен'}</h1>
				{v && (
					<>
						<p className="mt-4">&gt; Ваши личные данные — в вашем личном бюджете. Семейные остались в архиве.</p>
						<p className="mt-1 text-muted2">// Деньги приложение не делит: «забрать» — это копия в ваших счетах с текущим остатком. Шаги можно пропустить и вернуться к ним из архива (Настройки → Архив)</p>

						<h2 className="sec mt-8">Семейные счета</h2>
						{v.accounts.length === 0 ? <p className="mt-2 text-muted">// Нет</p> : (
							<ul className="mt-2">
								{v.accounts.map((a) => (
									<Row key={a.id} title={a.name} sub={`${fmt(a.balance)} ${a.currency}`}>
										{a.claimedBy ? <Claimed by={a.claimedBy} mine={a.mine} /> : <button className="tb" disabled={busy} onClick={() => void step('claim-account', a.id, `Счёт «${a.name}» теперь у вас`)}>Забрать к себе</button>}
									</Row>
								))}
							</ul>
						)}

						<h2 className="sec mt-8">Семейные копилки</h2>
						{v.goals.length === 0 ? <p className="mt-2 text-muted">// Нет</p> : (
							<ul className="mt-2">
								{v.goals.map((g) => (
									<Row key={g.id} title={g.name} sub={`${fmt(g.allocated)} из ${fmt(g.target)} ${g.currency}`}>
										{copied.has(`copy-goal:${g.id}`) ? <span className="text-muted">Создана у вас</span> : <button className="tb max-sm:whitespace-normal" disabled={busy} onClick={() => void step('copy-goal', g.id, `Копилка «${g.name}» создана у вас`)}>Создать такую же у себя</button>}
									</Row>
								))}
							</ul>
						)}

						<h2 className="sec mt-8">Регулярные</h2>
						{v.recurring.length === 0 ? <p className="mt-2 text-muted">// Нет</p> : (
							<ul className="mt-2">
								{v.recurring.map((p) => (
									<Row key={p.id} title={p.name} sub={`${fmt(p.amount)} ${p.currency}`}>
										{p.claimedBy ? <Claimed by={p.claimedBy} mine={p.mine} /> : <button className="tb" disabled={busy} onClick={() => void step('claim-recurring', p.id, `Платёж «${p.name}» теперь у вас`)}>Продолжаю платить</button>}
									</Row>
								))}
							</ul>
						)}

						<h2 className="sec mt-8">Категории</h2>
						<p className="mt-2 text-muted">{v.categories.length ? v.categories.join(' · ') : '// Нет'}</p>
						{v.categories.length > 0 && <button className="tb mt-3 max-sm:w-full max-sm:whitespace-normal" disabled={busy} onClick={() => void step('copy-categories')}>Скопировать все семейные категории к себе</button>}

						<div className="mt-10 flex flex-wrap gap-3">
							<button className="tb h-12 font-bold sm:h-auto" disabled={busy} onClick={() => void step('done')}>Готово</button>
							<Link href={`/archive/${householdId}`} className="tb h-12 sm:h-auto">Открыть архив</Link>
						</div>
					</>
				)}
				<p className="mt-4 min-h-5" role="status">{note}</p>
				{!v && note && <Link href="/" className="tb">На главную</Link>}
			</div>
		</div>
	)
}
