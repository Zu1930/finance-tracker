'use client'

import { useEffect, useRef } from 'react'
import { useTracker } from './TrackerProvider'
import { useSpace } from './SpaceProvider'
import { SPACE, SPACE_IDS, spaceLeft, type Space } from '@/lib/space'
import { Icon } from './icons/Icon'
import { IconText, spaceIcon } from './icons/IconText'
import { t } from '@/lib/i18n'
import { curMonthKey, fmt } from '@/lib/utils'

/** Описание строки выбора бюджета */
export function spaceDesc(s: Space, names: string[]) {
	if (s === 'family') return `${names.join(' и ')} · видят оба`
	if (s === 'personal') return 'Только вы'
	return 'Семья + ваше личное · только просмотр'
}

/**
 * [ ◆ СЕМЬЯ ▾ ] в шапке и выбор бюджета: на мобильном — панель сверху, на десктопе — выпадающий список.
 * Закрывается по Esc, клику вне и выбору. Открыть может и кнопка «+» в «всё вместе» (chooserOpen в контексте)
 */
export function SpaceSwitcher() {
	const { data } = useTracker()
	const { space, setSpace, switchable, chooserOpen: open, setChooserOpen: setOpen } = useSpace()
	const boxRef = useRef<HTMLDivElement>(null)
	const btnRef = useRef<HTMLButtonElement>(null)

	useEffect(() => {
		if (!open) return
		boxRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return
			setOpen(false)
			btnRef.current?.focus()
		}
		const onDown = (e: PointerEvent) => {
			if (!boxRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false)
		}
		document.addEventListener('keydown', onKey)
		document.addEventListener('pointerdown', onDown)
		return () => {
			document.removeEventListener('keydown', onKey)
			document.removeEventListener('pointerdown', onDown)
		}
	}, [open, setOpen])

	if (!switchable) return null
	const key = curMonthKey()
	const names = [data.me.name, ...(data.partner ? [data.partner.name] : [])]
	const pick = (s: Space) => {
		setSpace(s)
		setOpen(false)
		btnRef.current?.focus()
	}

	return (
		<div className="relative">
			<button
				ref={btnRef}
				className="tbox min-h-11 gap-2 border-ink px-3 font-bold sm:min-h-10"
				aria-haspopup="dialog"
				aria-expanded={open}
				title={`${t('space.budget')} (Alt + 1 / 2 / 3)`}
				onClick={() => setOpen(!open)}
			>
				<Icon name={spaceIcon(space)} size={16} />
				{SPACE[space].name}
				<Icon name="chevron" size={16} className="text-muted" />
			</button>
			{open && (
				<>
					{/* Мобильный: затемнение под панелью */}
					<div aria-hidden="true" className="fixed inset-0 z-30 sm:hidden" style={{ background: 'rgba(0,0,0,.35)' }} />
					<div
						ref={boxRef}
						role="dialog"
						aria-label={t('space.budget')}
						className="fixed inset-x-0 top-0 z-40 flex flex-col gap-1 border-b border-ink bg-panel p-4 pt-[calc(16px+env(safe-area-inset-top,0px))] sm:absolute sm:top-full sm:right-auto sm:left-0 sm:mt-2 sm:w-[420px] sm:border sm:pt-4"
					>
						<div className="mb-1 flex items-center justify-between">
							<b className="uppercase">:: {t('space.choose')}</b>
							<button className="ib -mr-2" onClick={() => setOpen(false)}><Icon name="close" size={20} label={t('action.close')} /></button>
						</div>
						{SPACE_IDS.map((s) => (
							<button
								key={s}
								aria-pressed={space === s}
								className="tbox grid min-h-16 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 text-left normal-case"
								onClick={() => pick(s)}
							>
								<Icon name={spaceIcon(s)} size={20} />
								<span className="flex min-w-0 flex-col">
									<b className="uppercase">{SPACE[s].name}</b>
									<span className="truncate text-xs opacity-75">{spaceDesc(s, names)}</span>
								</span>
								<span className="text-xs opacity-75">{fmt(Math.round(spaceLeft(data, s, key).left))}</span>
							</button>
						))}
					</div>
				</>
			)}
		</div>
	)
}

/** Строка «только просмотр» с кнопками выбора бюджета — вместо формы ввода на десктопе */
export function ReadOnlyPick() {
	const { setSpace } = useSpace()
	return (
		<div className="flex flex-wrap items-center gap-x-6 gap-y-3 border border-dashed border-line2 px-4 py-3">
			<IconText name="view" className="text-muted">{t('space.readOnly')}</IconText>
			<div className="tgroup" role="group" aria-label="Бюджет для записи">
				{(['family', 'personal'] as const).map((s) => (
					<button key={s} className="tb" onClick={() => setSpace(s)}><IconText name={spaceIcon(s)}>{SPACE[s].name}</IconText></button>
				))}
			</div>
		</div>
	)
}
