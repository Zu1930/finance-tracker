'use client'

import { useEffect, useState } from 'react'
import { useTracker } from '../TrackerProvider'
import type { Expense, Income, Scope } from '@/lib/types'
import { useEntryForm, type EntryMode } from './EntryForm'
import { activeCats, byRecentUse, fmt, incomeSources, liveCats, numIn, parseAmount, termName, uid } from '@/lib/utils'
import { itemLeft, itemStatus, linkedByItem } from '@/lib/plan'
import { monthOccurrences } from '@/lib/metrics'
import { matchPayment } from '@/lib/recurring'
import { glyph } from '@/lib/space'
import type { ParsedEntry } from '@/lib/quick-entry/parse'

/**
 * Черновик записи — общий для формы на десктопе и формы поверх ленты на телефоне:
 * категории бюджета, источники, валюта, связь с планом и регулярными, проверка и запись с тостом «Отменить»
 */
export function useEntryDraft(scope: Scope, mode: EntryMode) {
	const { data, isSolo, addEntry, removeEntry, toast } = useTracker()
	const st = data.settings!

	// Порядок категорий = последние использованные первыми; от него зависят номера и Alt + 1..9
	const familyCats = byRecentUse(activeCats(st), data.familyExpenses)
	const personalCats = byRecentUse(liveCats(data.mySettings.personalCategories), data.myExpenses)
	const cats = scope === 'personal' ? personalCats : familyCats
	const sources = incomeSources(st)

	// Семейные траты — в общей валюте; личные траты и доходы — в моей валюте из настроек
	const mine = data.mySettings.preferredCurrency
	const myCurrency = mine && st.currencies.includes(mine) ? mine : st.base
	const defaultCur = (sc: Scope) => (sc === 'family' ? st.base : myCurrency)
	const form = useEntryForm(mode === 'expense' ? defaultCur(scope) : myCurrency)
	// Выбранная категория — отдельно для семейного и личного
	const [catIds, setCatIds] = useState<Record<Scope, string | null>>({ family: null, personal: null })
	const catId = catIds[scope]
	const setCatId = (id: string | null) => setCatIds((c) => ({ ...c, [scope]: id }))
	// Поступления почти всегда из одного источника, поэтому выбор не сбрасывается после записи
	const [srcId, setSrcId] = useState(sources[0].id)
	const src = sources.find((s) => s.id === srcId) ?? sources[0]

	// Пункты плана выбранной категории в месяце даты траты, ещё не купленные полностью
	const planMonth = form.date.slice(0, 7)
	const plan = data.plans[planMonth]
	const scopeItems = (scope === 'personal' ? plan?.items.mine : plan?.items.family) ?? []
	const linked = linkedByItem([...(data.familyExpenses[planMonth] ?? []), ...(data.myExpenses[planMonth] ?? [])], scopeItems)
	const planChips = mode === 'expense' ? scopeItems.filter((i) => i.categoryId === catId && itemStatus(i, linked[i.id] ?? 0) !== 'done') : []
	const [planId, setPlanId] = useState<string | null>(null)
	const planItem = planChips.find((i) => i.id === planId)
	// Ручная трата похожа на неоплаченный регулярный платёж этой категории (±10%) — предложить связать
	const amountBase = (() => {
		const a = parseAmount(form.amount)
		const r = form.currency === st.base ? 1 : st.rates[form.currency]
		return a && a > 0 && r ? a * r : 0
	})()
	const occ = monthOccurrences(data, planMonth, form.date)
	const match = mode === 'expense' && catId && amountBase > 0
		? matchPayment([...(scope === 'personal' ? occ.mine : occ.family)].map((o) => ({ ...o, month: planMonth })), catId, amountBase)
		: undefined
	const [recId, setRecId] = useState<string | null>(null)
	const recurring = match && match.paymentId === recId ? match : undefined
	// Смена категории, бюджета или режима сбрасывает выбранный пункт и платёж
	useEffect(() => {
		setPlanId(null)
		setRecId(null)
	}, [catId, scope, mode])

	const pickPlan = (id: string) => {
		const it = planChips.find((i) => i.id === id)
		if (!it || planId === id) return setPlanId(null)
		setPlanId(id)
		setRecId(null)
		// Сумма пустая — подставить остаток пункта; он в базовой валюте
		if (!form.amount.trim()) {
			form.setCur(st.base)
			form.setAmount(String(itemLeft(it, linked[it.id] ?? 0)))
		}
		form.focusAmount()
	}
	const pickRecurring = (id: string) => {
		setRecId(recId === id ? null : id)
		setPlanId(null)
	}

	/** Трата из голосового ввода → форма для ручной правки (бюджет переключает вызывающий) */
	const fillParsed = (p: ParsedEntry) => {
		form.fill({ amount: p.amount === null ? '' : numIn(p.amount), currency: p.currency, note: p.note, date: p.date }, defaultCur(p.scope) !== defaultCur(scope))
		setCatIds((c) => ({ ...c, [p.scope]: p.categoryId }))
	}

	const mark = (sc: Scope) => (isSolo ? '' : `${glyph(sc)} `)
	/** Записать. true — записано (форма очищена, тост с отменой) */
	const submit = (): boolean => {
		if (mode === 'expense') {
			const cat = cats.find((c) => c.id === catId)
			const entry = form.collect(() => (cat ? null : 'Выберите категорию.'))
			if (!entry || !cat) return false
			const e: Expense = { id: uid(), ...entry, catId: cat.id, scope, authorId: data.me.id, ...(planItem && entry.date.slice(0, 7) === planMonth && { planItemId: planItem.id }),
				...(!planItem && recurring && { recurringId: recurring.paymentId, recurringMonth: recurring.month }) }
			addEntry('expense', e)
			setCatId(null)
			const tag = e.planItemId && planItem
				? ` // План ${(linked[planItem.id] ?? 0) + e.base >= planItem.amount ? '✓' : '~'}`
				: e.recurringId && recurring ? ` // ↻ ${termName(recurring.name)}` : ''
			form.reset()
			toast(`Записано: −${fmt(e.amount)} ${e.currency} → ${mark(scope)}${termName(cat.name)}${tag}`, 'Отменить', () => removeEntry('expense', e))
			return true
		}
		const entry = form.collect()
		if (!entry) return false
		const i: Income = { id: uid(), ...entry, sourceId: src.id, authorId: data.me.id }
		addEntry('income', i)
		form.reset()
		toast(`Записано: +${fmt(i.amount)} ${i.currency} → ${termName(src.name)}`, 'Отменить', () => removeEntry('income', i))
		return true
	}

	return {
		form, cats, familyCats, personalCats, sources,
		catId, setCatId, src, setSrcId,
		planChips, planId, pickPlan, linked, match, recId, pickRecurring,
		fillParsed, submit,
	}
}

export type EntryDraft = ReturnType<typeof useEntryDraft>
