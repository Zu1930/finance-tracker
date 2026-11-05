'use client'

import Link from 'next/link'
import { useTracker } from '../TrackerProvider'
import { useSpace } from '../SpaceProvider'
import { Icon } from '../icons/Icon'
import { spaceIcon } from '../icons/IconText'
import { spaceCats, spaceGroups } from '@/lib/space'
import { t } from '@/lib/i18n'
import { curMonthKey, fmt, termName } from '@/lib/utils'

/**
 * Мини-лимиты (четвёртая колонка ввода на 1920+): категории выбранного бюджета строками — название, остаток,
 * полоска 4px. Клик — «Лимиты» с этой категорией (/limits#cat-<id>: прокрутка и подсветка)
 */
export function MiniLimits({ className = '' }: { className?: string }) {
	const { data, isSolo } = useTracker()
	const { view } = useSpace()
	const month = curMonthKey()
	const groups = isSolo ? (['personal'] as const) : spaceGroups(view)
	return (
		<section aria-label={t('nav.limits')} className={`flex flex-col gap-4 ${className}`}>
			<h2 className="sec">{t('nav.limits')}</h2>
			{groups.map((g) => {
				const rows = spaceCats(data, g, month)
				return (
					<ul key={g} className="flex flex-col">
						{rows.map(({ cat, spent }) => {
							const left = cat.limit - spent
							const pct = cat.limit > 0 ? Math.min(100, (spent / cat.limit) * 100) : spent > 0 ? 100 : 0
							return (
								<li key={cat.id}>
									<Link href={`/limits#cat-${cat.id}`} className="flex flex-col gap-1 border-b border-dashed border-line2 py-1.5 hover:bg-hover">
										<span className="flex items-baseline justify-between gap-2 uppercase">
											<span className="flex min-w-0 items-center gap-1.5">
												{!isSolo && groups.length > 1 && <Icon name={spaceIcon(g)} size={16} className="shrink-0 text-muted" />}
												<span className="truncate" title={cat.name}>{termName(cat.name)}</span>
											</span>
											<b className={`shrink-0 ${left < 0 ? 'text-bad' : ''}`}>{fmt(Math.round(left))}</b>
										</span>
										<span aria-hidden="true" className="block h-1 bg-line2">
											<span className={`block h-full ${left < 0 ? 'bg-bad' : 'bg-ink'}`} style={{ width: `${pct}%` }} />
										</span>
									</Link>
								</li>
							)
						})}
					</ul>
				)
			})}
		</section>
	)
}
