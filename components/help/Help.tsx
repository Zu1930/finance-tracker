'use client'

import { useEffect, type ReactNode } from 'react'
import { Icon } from '../icons/Icon'
import { t } from '@/lib/i18n'
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
			className={mobile ? 'flex min-h-[3.25rem] w-full items-center gap-3 border-b border-dashed border-line2 text-left uppercase' : 'mt-5 flex min-h-9 w-full items-baseline justify-between gap-3 px-2 py-1.5 text-left uppercase hover:bg-hover'}
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
		<div className="sm:grid sm:grid-cols-[16.25rem_1fr] sm:gap-10">
			<HelpMenu />
			<div className="min-w-0 max-w-[72ch]">{children}</div>
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
			<h1 className="text-[1.375rem] font-bold uppercase">Помощь</h1>
			<ul className="mt-4">
				{ARTICLES.map((a) => (
					<li key={a.id}>
						<Link href={`/help/${a.id}`} className="flex min-h-[3.25rem] items-center gap-3 border-b border-dashed border-line2 uppercase">
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
			<Link href="/help" className="mb-4 inline-flex min-h-11 items-center gap-2 text-muted uppercase hover:text-ink sm:hidden"><Icon name="back" size={20} />{t('nav.help')}</Link>
			{blocks.map((b, i) =>
				b.t === 'h' ? (
					b.level === 1 ? <h1 key={i} className="text-[1.375rem] font-bold uppercase">{isSolo && id === 'family' ? articleTitle(id, true) : <InlineText parts={b.text} />}</h1>
					: <h2 key={i} className="sec mt-7 text-[0.8125rem]"><InlineText parts={b.text} /></h2>
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

/**
 * Подсказка к разделу настроек (колонка справа на 1920+): текст статьи помощи без заголовка, мельче и приглушённо,
 * со ссылкой на статью целиком
 */
export function HelpAside({ id, md }: { id: ArticleId; md: string }) {
	const { isSolo } = useTracker()
	const blocks = parseMarkdown(forAudience(md, isSolo)).filter((b) => b.t !== 'h' || b.level > 1)
	return (
		<aside data-area="help" aria-label={t('nav.help')} className="hidden flex-col gap-2 border-l border-dashed border-line pl-5 text-[0.8125rem] text-muted [grid-area:help] huge:flex">
			<h2 className="sec">{articleTitle(id, isSolo)}</h2>
			{blocks.map((b, i) =>
				b.t === 'h' ? <h3 key={i} className="mt-2 font-bold uppercase"><InlineText parts={b.text} /></h3>
				: b.t === 'p' ? <p key={i}><InlineText parts={b.text} /></p>
				: <ul key={i} className="list-['–_'] space-y-1 pl-5">{b.items.map((it, k) => <li key={k}><InlineText parts={it} /></li>)}</ul>
			)}
			<Link href={`/help/${id}`} className="mt-1 uppercase underline underline-offset-4 hover:text-ink">{t('help.readAll')}</Link>
		</aside>
	)
}
