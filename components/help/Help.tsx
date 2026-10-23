'use client'

import { useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTracker } from '../TrackerProvider'
import { ARTICLES, articleTitle, type ArticleId } from '@/lib/help'
import { forAudience, parseMarkdown, type Inline } from '@/lib/markdown'

/** «Настройка бюджета»: вернуть скрытую карточку на ввод */
function SetupLink({ mobile }: { mobile: boolean }) {
	const { data, patchOnboarding } = useTracker()
	const router = useRouter()
	const ob = data.onboarding
	if (!ob || ob.status === 'pending' || !ob.dismissed) return null
	return (
		<button
			className={mobile ? 'flex min-h-[52px] w-full items-center gap-3 border-b border-dashed border-line2 text-left uppercase' : 'mt-5 flex min-h-9 w-full items-baseline justify-between gap-3 px-2 py-1.5 text-left uppercase hover:bg-hover'}
			onClick={() => {
				patchOnboarding({ dismiss: false })
				router.push('/')
			}}
		>
			<span className="flex-1">Настройка бюджета</span>
			<span className="text-xs text-muted">показать карточку</span>
			{mobile && <span aria-hidden="true" className="text-muted">›</span>}
		</button>
	)
}

function HelpMenu() {
	const { isSolo } = useTracker()
	const pathname = usePathname()
	return (
		<nav aria-label="Статьи помощи" className="sticky top-4 hidden self-start border-r border-dashed border-line pr-6 sm:block">
			<h1 className="sec">Помощь</h1>
			<ul className="mt-5">
				{ARTICLES.map((a) => {
					const active = pathname === `/help/${a.id}`
					return (
						<li key={a.id}>
							<Link href={`/help/${a.id}`} aria-current={active ? 'page' : undefined}
								className={`flex min-h-9 items-baseline px-2 py-1.5 uppercase ${active ? 'bg-ink text-panel' : 'hover:bg-hover'}`}>
								{articleTitle(a.id, isSolo)}
							</Link>
						</li>
					)
				})}
			</ul>
			<SetupLink mobile={false} />
		</nav>
	)
}

/** Каркас как у настроек: меню слева на десктопе, текст до 720px */
export function HelpFrame({ children }: { children: ReactNode }) {
	return (
		<div className="sm:grid sm:grid-cols-[260px_1fr] sm:gap-10">
			<HelpMenu />
			<div className="min-w-0 max-w-[720px]">{children}</div>
		</div>
	)
}

/** /help: на мобильном — список статей; на десктопе — сразу первая */
export function HelpIndex() {
	const { isSolo } = useTracker()
	const router = useRouter()
	useEffect(() => {
		if (matchMedia('(min-width: 640px)').matches) router.replace('/help/start')
	}, [router])
	return (
		<div className="sm:hidden">
			<h1 className="text-[22px] font-bold uppercase">Помощь</h1>
			<ul className="mt-4">
				{ARTICLES.map((a) => (
					<li key={a.id}>
						<Link href={`/help/${a.id}`} className="flex min-h-[52px] items-center gap-3 border-b border-dashed border-line2 uppercase">
							<span className="flex-1">{articleTitle(a.id, isSolo)}</span>
							<span aria-hidden="true" className="text-muted">›</span>
						</Link>
					</li>
				))}
			</ul>
			<SetupLink mobile />
		</div>
	)
}

const InlineText = ({ parts }: { parts: Inline[] }) => (
	<>
		{parts.map((p, i) =>
			p.t === 'code' ? <code key={i} className="border border-line2 px-1">{p.v}</code>
			: p.t === 'bold' ? <b key={i}>{p.v}</b>
			: p.t === 'link' ? (
				p.href.startsWith('/') ? <Link key={i} href={p.href} className="underline underline-offset-4">{p.v}</Link>
				: <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{p.v}</a>
			)
			: <span key={i}>{p.v}</span>,
		)}
	</>
)

/** Статья: Markdown из content/help; семейные блоки solo не видит */
export function Article({ id, md }: { id: ArticleId; md: string }) {
	const { isSolo } = useTracker()
	const blocks = parseMarkdown(forAudience(md, isSolo))
	return (
		<article>
			<Link href="/help" className="tb mb-4 sm:hidden">‹ Помощь</Link>
			{blocks.map((b, i) =>
				b.t === 'h' ? (
					b.level === 1 ? <h1 key={i} className="text-[22px] font-bold uppercase">{isSolo && id === 'family' ? articleTitle(id, true) : <InlineText parts={b.text} />}</h1>
					: <h2 key={i} className="sec mt-7 text-[13px]"><InlineText parts={b.text} /></h2>
				)
				: b.t === 'p' ? <p key={i} className="mt-3 max-w-[64ch]"><InlineText parts={b.text} /></p>
				: (() => {
					const L = b.t === 'ul' ? 'ul' : 'ol'
					return (
						<L key={i} className={`mt-3 max-w-[64ch] space-y-1 pl-6 ${b.t === 'ul' ? 'list-["–_"]' : 'list-decimal'}`}>
							{b.items.map((it, j) => <li key={j}><InlineText parts={it} /></li>)}
						</L>
					)
				})(),
			)}
		</article>
	)
}
