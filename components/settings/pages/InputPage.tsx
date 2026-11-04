'use client'

import { useEffect, useState } from 'react'
import { Block } from '../SettingsFrame'
import { QuickEntrySwitch, QuickTokens } from '../QuickTokens'
import { readPref, writePref, type EntryPref } from '../../entry/MobileEntry'

const PREFS: { id: EntryPref; label: string }[] = [
	{ id: 'last', label: 'Последний' },
	{ id: 'keys', label: 'Клавиши' },
	{ id: 'voice', label: 'Голос' },
]

/** Чем открывается форма по «+» на телефоне. Хранится в этом браузере: телефон и компьютер — разные устройства */
function EntryPrefSwitch() {
	const [pref, setPref] = useState<EntryPref>('last')
	useEffect(() => setPref(readPref()), [])
	return (
		<div className="tgroup uppercase" role="group" aria-label="Ввод на телефоне">
			{PREFS.map((p) => (
				<button key={p.id} className="tb" aria-pressed={pref === p.id} onClick={() => { writePref(p.id); setPref(p.id) }}>{p.label}</button>
			))}
		</div>
	)
}

/** Голос и Siri: способ ввода на телефоне, строка «● Голос» над формой на компьютере и токены Быстрых команд */
export function InputPage() {
	return (
		<>
			<Block title="Ввод на телефоне" note="удержание «+» — сразу голос">
				<EntryPrefSwitch />
			</Block>
			<Block title="Строка голосового ввода над формой на компьютере">
				<QuickEntrySwitch />
			</Block>
			<Block title="Siri" note="работает, даже если строка скрыта">
				<QuickTokens />
			</Block>
		</>
	)
}
