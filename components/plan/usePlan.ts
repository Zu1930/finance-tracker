'use client'

import { useTracker } from '../TrackerProvider'
import { emptyPlan, linkedByItem } from '@/lib/plan'
import type { PlanItem } from '@/lib/types'

/** План месяца: свой и семейный, связанные суммы по пунктам, сохранение частей плана */
export function usePlan(month: string) {
	const { data, api } = useTracker()
	const plan = data.plans[month] ?? emptyPlan(month)
	const items = [...plan.items.family, ...plan.items.mine]
	const expenses = [...(data.familyExpenses[month] ?? []), ...(data.myExpenses[month] ?? [])]
	const linked = linkedByItem(expenses, items)

	return {
		plan,
		items,
		linked,
		/** Семейная часть: доход и семейные поправки — документ пишется целиком с версией */
		savePlan: (patch: { incomeOverride?: number | null; limitOverrides?: Record<string, number> }) =>
			api(`/api/plan/${month}`, 'PUT', {
				version: plan.planVersion,
				data: { incomeOverride: plan.incomeOverride, limitOverrides: plan.familyOverrides, ...patch }
			}),
		saveMyPlan: (limitOverrides: Record<string, number>) =>
			api(`/api/my-plan/${month}`, 'PUT', { version: plan.myPlanVersion, data: { limitOverrides } })
	}
}

/** Поправка категории: задать или убрать (значение, равное обычному лимиту, сервер уберёт сам) */
export const withOverride = (o: Record<string, number>, id: string, v: number | null) => {
	const { [id]: _, ...rest } = o
	return v === null ? rest : { ...rest, [id]: v }
}

export type ItemRef = Pick<PlanItem, 'id' | 'scope' | 'month' | 'version'>
