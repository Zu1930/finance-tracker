'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useTracker } from '../TrackerProvider'
import { CHECKLIST, checklist, checklistDone, type ChecklistId, type ChecklistItem } from '@/lib/onboarding'

/** Свёрнут ли список карточки — в этом браузере */
const COLLAPSED_KEY = 'ft:setup-card-collapsed'
const readCollapsed = () => {
	try {
		return localStorage.getItem(COLLAPSED_KEY) === '1'
	} catch {
		return false
	}
}

/**
 * Ввод с карточкой «Настройка»: шесть пунктов, выполнение — из данных бюджета. × скрывает насовсем (вернуть — в помощи),
 * «не нужно» засчитывает пункт. Всё готово — один раз «Готово» и больше не появляется.
 * Десктоп (lg) — колонка 320px справа от формы; уже — строка над формой, раскрывается под собой
 */
export function WithSetupCard({ children }: { children: ReactNode }) {
	const { data, patchOnboarding } = useTracker()
	const ob = data.onboarding
	// «Готово» видно до конца этого визита, хотя на сервере карточка уже скрыта
	const [finished, setFinished] = useState(false)
	const items = ob ? checklist(data, ob) : []
	const n = checklistDone(items)
	const active = !!ob && ob.status !== 'pending' && !data.readonly && !ob.dismissed
	const all = items.length > 0 && n === items.length
	useEffect(() => {
		if (!active || !all) return
		setFinished(true)
		patchOnboarding({ dismiss: true })
	}, [active, all, patchOnboarding])

	if (!active && !finished) return <>{children}</>
	const card = (mobile: boolean) =>
		finished ? (
			<p className="border border-line px-4 py-3 font-bold uppercase" role="status">:: Готово — бюджет настроен</p>
		) : (
			<Card mobile={mobile} items={items} n={n} hide={(id) => patchOnboarding({ hide: id })} dismiss={() => patchOnboarding({ dismiss: true })} />
		)
	return (
		<>
			<div className="mb-4 lg:hidden">{card(true)}</div>
			<div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">
				<div className="min-w-0">{children}</div>
				<aside className="sticky top-4 hidden lg:block">{card(false)}</aside>
			</div>
		</>
	)
}

function Card({ mobile, items, n, hide, dismiss }: { mobile: boolean; items: ChecklistItem[]; n: number; hide: (id: ChecklistId) => void; dismiss: () => void }) {
	const [open, setOpen] = useState(!mobile)
	const [menu, setMenu] = useState<string | null>(null)
	useEffect(() => {
		if (!mobile) setOpen(!readCollapsed())
	}, [mobile])
	const toggle = () => {
		const v = !open
		setOpen(v)
		if (!mobile)
			try {
				localStorage.setItem(COLLAPSED_KEY, v ? '0' : '1')
			} catch {}
	}
	const scale = '█'.repeat(n * 4) + '░'.repeat(24 - n * 4)

	return (
		<section className="border border-line" aria-label="Настройка бюджета">
			<div className="flex items-center gap-1 pr-1">
				<button className="flex min-h-11 flex-1 items-center gap-2 pl-4 text-left font-bold uppercase" aria-expanded={open} onClick={toggle}>
					:: Настройка {n}/6 <span aria-hidden="true" className="ml-auto font-normal text-muted">{open ? '▾' : mobile ? '›' : '▸'}</span>
				</button>
				<button className="xb" aria-label="Скрыть карточку «Настройка»" onClick={dismiss}>×</button>
			</div>
			{open && (
				<div className="px-4 pb-4">
					<p className="overflow-hidden text-muted whitespace-nowrap" aria-hidden="true">{scale}</p>
					<ul className="mt-2">
						{CHECKLIST.map((c) => {
							const it = items.find((i) => i.id === c.id)!
							const ok = it.done || it.hidden
							return (
								<li key={c.id} className="border-b border-dashed border-line2 py-1 last:border-0">
									<div className="flex min-h-11 items-center gap-2">
										<span className={`min-w-0 flex-1 ${ok ? 'text-muted' : ''}`}>
											<span aria-hidden="true">{ok ? '[✓] ' : '[ ] '}</span>
											<span className="sr-only">{ok ? 'Готово: ' : 'Не готово: '}</span>
											{c.title}
											{it.hidden && !it.done && <span className="text-xs"> // не нужно</span>}
										</span>
										{!ok && (
											<>
												<Link href={c.href} className="tb shrink-0 uppercase">{c.action}</Link>
												<button className="tb tb-tight min-h-11 shrink-0" aria-label={`Ещё: ${c.title}`} aria-expanded={menu === c.id} onClick={() => setMenu(menu === c.id ? null : c.id)}>…</button>
											</>
										)}
									</div>
									{menu === c.id && !ok && (
										<div className="pb-2 text-right">
											<button className="tb uppercase" onClick={() => { setMenu(null); hide(c.id) }}>Не нужно</button>
										</div>
									)}
								</li>
							)
						})}
					</ul>
					<p className="mt-3 text-xs text-muted2">Карточка исчезнет сама, когда всё готово.</p>
				</div>
			)}
		</section>
	)
}
