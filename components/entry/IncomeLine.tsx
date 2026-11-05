'use client'

import { useTracker } from '../TrackerProvider'
import { Icon } from '../icons/Icon'
import { familyMembers, incomeByMember } from '@/lib/metrics'
import { t } from '@/lib/i18n'
import { fmt, monthName } from '@/lib/utils'

/**
 * «ДОХОДЫ ЗА НОЯБРЬ · ВЛАД 246 120 · МАША 150 000» — над лентой ◆ и ∑ вместо записей доходов (они личные).
 * Участники по порядку вступления, у кого доходов нет — 0
 */
export function IncomeLine({ month }: { month: string }) {
	const { data } = useTracker()
	const by = incomeByMember(data, month)
	return (
		<p className="flex items-baseline gap-2.5 border-b border-dashed border-line2 py-2 text-xs uppercase">
			<Icon name="income" size={16} className="shrink-0 self-center" />
			<span>
				<span className="text-muted">{t('income.monthLine', { m: monthName(month) })}</span>
				{familyMembers(data).map((u) => <span key={u.id}> · {u.name} <b>{fmt(by[u.id] ?? 0)}</b></span>)}
			</span>
		</p>
	)
}
