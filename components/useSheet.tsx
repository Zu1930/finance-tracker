'use client'

import { useEffect, useSyncExternalStore, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** Корень приложения: пока открыта шторка, он inert. Шторки и тост вынесены из него порталом в body */
export const APP_ROOT_ID = 'app-root'

/** Дети — в body, вне корня приложения. На сервере и при гидратации — ничего (хук без эффекта, без мигания) */
export function Portal({ children }: { children: ReactNode }) {
	const client = useSyncExternalStore(() => () => {}, () => true, () => false)
	return client ? createPortal(children, document.body) : null
}

/** Вместо autoFocus в шторках: фокус при монтировании без прокрутки страницы */
export const focusNoScroll = (el: HTMLElement | null) => el?.focus({ preventScroll: true })

// ---------- Блокировка страницы ----------
// Только overflow:hidden на прокручиваемых контейнерах: позиция прокрутки сохраняется сама, body/html не трогаем (на iOS это сдвигало видимую область).
// Шторки могут быть открыты одновременно (план поверх лимитов) — общий счётчик: снимается, когда закрыта последняя
let locks = 0

// На мобильном прокручивается #app-scroll, на десктопе — #page: блокируем оба
const SCROLLERS = ['app-scroll', 'page']
const scrollers = () => SCROLLERS.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el)

function lock() {
	if (locks++ > 0) return
	for (const el of scrollers()) {
		// Полоса прокрутки на десктопе пропадёт — компенсируем отступом, чтобы страница не прыгала
		const bar = el.offsetWidth - el.clientWidth
		el.style.overflow = 'hidden'
		if (bar > 0) el.style.paddingRight = `${bar}px`
	}
}
function unlock() {
	if (--locks > 0) return
	for (const el of scrollers()) {
		el.style.removeProperty('overflow')
		el.style.removeProperty('padding-right')
	}
}

/** Пока шторка открыта, страница (#app-scroll) не прокручивается */
export function useScrollLock(open: boolean) {
	useEffect(() => {
		if (!open) return
		lock()
		return unlock
	}, [open])
}

let inerts = 0
/** Контент приложения под шторкой — inert: касания, фокус и скринридер его не видят */
export function useInertApp(open: boolean) {
	useEffect(() => {
		if (!open) return
		const root = document.getElementById(APP_ROOT_ID)
		if (inerts++ === 0) root?.setAttribute('inert', '')
		return () => {
			if (--inerts === 0) document.getElementById(APP_ROOT_ID)?.removeAttribute('inert')
		}
	}, [open])
}

// ---------- Раскладка шторки ввода ----------
const TOP = 16 // отступ шторки сверху, px
const KEY_MIN = 44
const KEY_MAX = 64
const KEY_DEFAULT = 52

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Раскладка шторки только из измерений. Шторка — колонка: шапка | середина (прокручивается) | низ (клавиши и «Записать»).
 * --avail = высота видимой области (visualViewport) минус отступ сверху; шторка высотой по содержимому, не выше --avail,
 * прижата к низу видимой области. Клавиша — clamp(44, (avail − шапка − середина − отступы низа) / 4, 64): места мало —
 * клавиши 44px и прокручивается середина, места много — клавиши до 64px, без промежутков.
 * Переменные --avail, --sheet-bottom и --key-h пишутся в style шторки; CSS их только читает.
 * Метки в разметке: [data-sheet-inner] — единственный потомок середины, [data-keys] — сетка клавиш
 */
export function useSheetLayout(sheetRef: RefObject<HTMLElement | null>, middleRef: RefObject<HTMLElement | null>) {
	const [keyH, setKeyH] = useState(KEY_DEFAULT)

	useEffect(() => {
		const sheet = sheetRef.current
		if (!sheet) return
		const vv = window.visualViewport
		let last = KEY_DEFAULT
		let frame = 0

		const measure = () => {
			frame = 0
			const vh = vv?.height ?? window.innerHeight
			const offTop = vv?.offsetTop ?? 0
			// Низ видимой области в координатах fixed: при открытой системной клавиатуре шторка стоит над ней
			// Сдвиг вверх — только если открыта системная клавиатура; иначе шторка у нижнего края (bottom: 0)
			const kb = window.innerHeight - vh > 100
			const bottom = kb ? Math.max(0, Math.round(window.innerHeight - vh - offTop)) : 0
			const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0
			const avail = Math.max(0, Math.floor(vh - TOP - sat))
			sheet.style.setProperty('--avail', `${avail}px`)
			sheet.style.setProperty('--sheet-bottom', `${bottom}px`)

			const head = sheet.firstElementChild as HTMLElement | null
			const foot = sheet.lastElementChild as HTMLElement | null
			const mid = middleRef.current
			const inner = mid?.firstElementChild as HTMLElement | null
			const keys = sheet.querySelector<HTMLElement>('[data-keys]')
			if (head && foot && inner && keys) {
				const gap = parseFloat(getComputedStyle(keys).rowGap) || 0
				// Рамка шторки: высота минус высоты трёх частей (середина может быть сжата — берём её фактическую)
				const parts = [...sheet.children].reduce((s, c) => s + (c as HTMLElement).offsetHeight, 0)
				const frame_ = sheet.offsetHeight - parts
				const footExtra = foot.offsetHeight - keys.offsetHeight
				const free = avail - frame_ - head.offsetHeight - inner.offsetHeight - footExtra - gap * 3
				const next = clamp(Math.floor(free / 4), KEY_MIN, KEY_MAX)
				if (next !== last) {
					last = next
					setKeyH(next)
				}
			}
			sheet.style.setProperty('--key-h', `${last}px`)
			// Тост, пока шторка открыта, — под её шапкой (правило в globals.css)
			const top = window.innerHeight - bottom - sheet.offsetHeight
			document.documentElement.style.setProperty('--entry-top', `${Math.round(top + (head?.offsetHeight ?? 0))}px`)
		}
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(measure)
		}

		// Следим за размерами частей и содержимого середины; при смене состава (клавиши ↔ голос) подписываемся заново
		const ro = new ResizeObserver(schedule)
		const attach = () => {
			ro.disconnect()
			for (const c of sheet.children) ro.observe(c)
			const inner = middleRef.current?.firstElementChild
			if (inner) ro.observe(inner)
			const keys = sheet.querySelector('[data-keys]')
			if (keys) ro.observe(keys)
		}
		const mo = new MutationObserver(() => {
			attach()
			schedule()
		})
		mo.observe(sheet, { childList: true })
		attach()
		measure()
		// После применения блокировки и отрисовки шторки — ещё раз, и по окончании анимации открытия
		let r1 = requestAnimationFrame(() => (r1 = requestAnimationFrame(measure)))
		sheet.addEventListener('animationend', schedule)

		vv?.addEventListener('resize', schedule)
		vv?.addEventListener('scroll', schedule)
		window.addEventListener('resize', schedule)
		return () => {
			cancelAnimationFrame(frame)
			cancelAnimationFrame(r1)
			sheet.removeEventListener('animationend', schedule)
			ro.disconnect()
			mo.disconnect()
			vv?.removeEventListener('resize', schedule)
			vv?.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', schedule)
			document.documentElement.style.removeProperty('--entry-top')
		}
	}, [sheetRef, middleRef])

	return { keyH }
}
