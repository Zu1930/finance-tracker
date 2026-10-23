'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'

export const MIN_PASSWORD = 10

type TurnstileOptions = {
	sitekey: string
	callback: (t: string) => void
	'expired-callback': () => void
	theme: 'light' | 'dark' | 'auto'
	appearance: 'always' | 'execute' | 'interaction-only'
	size: 'normal' | 'compact' | 'flexible'
}
type Turnstile = { render: (el: HTMLElement, o: TurnstileOptions) => string; reset: (id: string) => void }
declare global {
	interface Window {
		turnstile?: Turnstile
	}
}

/**
 * Cloudflare Turnstile: виден, только если нужна проверка (interaction-only), по ширине формы, в теме приложения
 * (data-theme на <html>; без неё — как в системе). Без siteKey (разработка, тесты) — не показывается, токен пустой
 */
export function useTurnstile(siteKey: string | undefined) {
	const box = useRef<HTMLDivElement>(null)
	const widget = useRef<string | null>(null)
	const [token, setToken] = useState('')
	useEffect(() => {
		if (!siteKey) return
		const render = () => {
			if (!box.current || !window.turnstile || widget.current) return
			const t = document.documentElement.dataset.theme
			widget.current = window.turnstile.render(box.current, {
				sitekey: siteKey, callback: setToken, 'expired-callback': () => setToken(''),
				theme: t === 'dark' || t === 'light' ? t : 'auto', appearance: 'interaction-only', size: 'flexible',
			})
		}
		if (window.turnstile) return render()
		const s = document.createElement('script')
		s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
		s.async = true
		s.onload = render
		document.head.appendChild(s)
	}, [siteKey])
	const reset = () => {
		setToken('')
		if (widget.current && window.turnstile) window.turnstile.reset(widget.current)
	}
	// Без min-height: при interaction-only виджет обычно невидим и места не занимает
	const el = siteKey ? <div ref={box} className="mt-4 w-full empty:mt-0" /> : null
	return { el, token, ready: !siteKey || !!token, headers: (token ? { 'x-captcha-response': token } : {}) as Record<string, string>, reset }
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
	fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).catch(() => null)

const code = async (res: Response) => ((await res.json().catch(() => ({}))) as { code?: string }).code ?? ''

export function Field({ id, label, ...p }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
	return (
		<div className="mt-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
			<label htmlFor={id} className="lbl w-[13ch] shrink-0">{label}</label>
			<input id={id} className="tfield flex-1" {...p} />
		</div>
	)
}

export function AuthFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
	return (
		<div className="px-4">
			<div className="mx-auto mt-[10vh] max-w-sm pb-12">
				<h1 className="sec">{title}</h1>
				{children}
				{footer && <div className="mt-8 flex flex-wrap gap-x-4 gap-y-2 uppercase">{footer}</div>}
			</div>
		</div>
	)
}

export const Alert = ({ text }: { text: string }) => <p className="mt-3 min-h-5 text-bad uppercase" role="alert">{text && `!! ${text}`}</p>

/** Регистрация: имя, email, пароль дважды; в режиме invite — код (или ссылка-приглашение, тогда код не нужен) */
export function SignupForm({ siteKey, mode, invite, initialCode }: { siteKey?: string; mode: 'invite' | 'open'; invite?: string; initialCode?: string }) {
	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [again, setAgain] = useState('')
	const [signupCode, setCode] = useState(initialCode ?? '')
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const ts = useTurnstile(siteKey)
	const needCode = mode === 'invite' && !invite

	const submit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (password.length < MIN_PASSWORD) return setError(`Пароль — минимум ${MIN_PASSWORD} символов`)
		if (password !== again) return setError('Пароли не совпадают')
		setBusy(true)
		setError('')
		const res = await post('sign-up/email', {
			name: name.trim(), email: email.trim(), password,
			...(invite ? { inviteCode: invite } : needCode ? { signupCode } : {}),
			callbackURL: invite ? `/join/${invite}` : '/',
		}, ts.headers)
		if (res?.ok) {
			window.location.href = `/check-email?email=${encodeURIComponent(email.trim())}${invite ? `&invite=${encodeURIComponent(invite)}` : ''}`
			return
		}
		setBusy(false)
		ts.reset()
		const c = res ? await code(res) : ''
		setError(!res ? 'Сервер недоступен'
			: res.status === 429 ? 'Слишком много попыток, подождите'
			: c === 'SIGNUP_CODE_INVALID' ? (invite ? 'Приглашение недействительно' : 'Регистрация недоступна: проверьте код')
			: c === 'INVALID_EMAIL' ? 'Неверный email'
			: c === 'PASSWORD_TOO_SHORT' ? `Пароль — минимум ${MIN_PASSWORD} символов`
			: c.startsWith('CAPTCHA') || c === 'MISSING_RESPONSE' || c === 'VERIFICATION_FAILED' ? 'Проверка не пройдена, попробуйте ещё раз'
			: 'Не удалось зарегистрироваться')
	}

	return (
		<AuthFrame title="Регистрация" footer={<><Link href={invite ? `/login?next=/join/${invite}` : '/login'} className="tb">Уже есть аккаунт</Link><Link href="/privacy" className="tb">Конфиденциальность</Link></>}>
			{invite && <p className="mt-4 uppercase text-muted">// Регистрация по приглашению в семью</p>}
			<form onSubmit={submit}>
				<Field id="name" label="Имя" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
				<Field id="email" label="Email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
				<Field id="pw" label="Пароль" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
				<Field id="pw2" label="Ещё раз" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
				{needCode && <Field id="code" label="Код" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX" value={signupCode} onChange={(e) => setCode(e.target.value)} />}
				<p className="mt-2 text-muted2">// Пароль — минимум {MIN_PASSWORD} символов. После регистрации придёт письмо для подтверждения email</p>
				{ts.el}
				<button className="tb mt-6 h-12 w-full font-bold sm:h-auto" disabled={busy || !ts.ready || !name.trim() || !email.trim() || !password || !again || (needCode && !signupCode.trim())}>
					{busy ? 'Регистрирую…' : 'Зарегистрироваться'}
				</button>
				<Alert text={error} />
			</form>
		</AuthFrame>
	)
}

/** «Проверьте почту»: единственное, что доступно до подтверждения email. Повторное письмо — не чаще раза в минуту */
export function CheckEmail({ email, invite }: { email: string; invite?: string }) {
	const [wait, setWait] = useState(60)
	const [note, setNote] = useState('')
	useEffect(() => {
		if (wait <= 0) return
		const t = setTimeout(() => setWait((w) => w - 1), 1000)
		return () => clearTimeout(t)
	}, [wait])
	const resend = async () => {
		setWait(60)
		const res = await post('send-verification-email', { email, callbackURL: invite ? `/join/${invite}` : '/' })
		setNote(!res ? '!! Сервер недоступен' : res.status === 429 ? '!! Не чаще раза в минуту' : res.ok ? '> Письмо отправлено ещё раз' : '!! Не удалось отправить')
	}
	return (
		<AuthFrame title="Проверьте почту" footer={<Link href="/login" className="tb">Ко входу</Link>}>
			<p className="mt-6 uppercase">&gt; Мы отправили письмо на <b className="normal-case">{email || 'ваш email'}</b></p>
			<p className="mt-2 text-muted2">// Откройте ссылку из письма, чтобы подтвердить email. До этого войти нельзя. Письма нет — проверьте «Спам»</p>
			<button className="tb mt-6 h-12 w-full sm:h-auto" disabled={!email || wait > 0} onClick={() => void resend()}>
				{wait > 0 ? `Отправить ещё раз (${wait})` : 'Отправить ещё раз'}
			</button>
			<p className="mt-3 min-h-5 uppercase" role="status">{note}</p>
		</AuthFrame>
	)
}

/** «Забыли пароль»: письмо со ссылкой; ответ одинаковый, есть такой email или нет */
export function ForgotForm({ siteKey }: { siteKey?: string }) {
	const [email, setEmail] = useState('')
	const [sent, setSent] = useState(false)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const ts = useTurnstile(siteKey)
	const submit = async (e: React.FormEvent) => {
		e.preventDefault()
		setBusy(true)
		setError('')
		const res = await post('request-password-reset', { email: email.trim(), redirectTo: '/reset-password' }, ts.headers)
		setBusy(false)
		ts.reset()
		if (res?.ok) return setSent(true)
		setError(!res ? 'Сервер недоступен' : res.status === 429 ? 'Слишком много попыток, подождите' : 'Не удалось отправить письмо')
	}
	return (
		<AuthFrame title="Сброс пароля" footer={<Link href="/login" className="tb">Ко входу</Link>}>
			{sent ? (
				<>
					<p className="mt-6 uppercase">&gt; Если аккаунт с этим email есть, письмо со ссылкой уже отправлено</p>
					<p className="mt-2 text-muted2">// Ссылка действует 1 час. Письма нет — проверьте «Спам»</p>
				</>
			) : (
				<form onSubmit={submit}>
					<Field id="email" label="Email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
					{ts.el}
					<button className="tb mt-6 h-12 w-full font-bold sm:h-auto" disabled={busy || !ts.ready || !email.trim()}>{busy ? 'Отправляю…' : 'Прислать ссылку'}</button>
					<Alert text={error} />
				</form>
			)}
		</AuthFrame>
	)
}

/** Новый пароль по ссылке из письма */
export function ResetForm({ token, invalid }: { token: string; invalid: boolean }) {
	const [password, setPassword] = useState('')
	const [again, setAgain] = useState('')
	const [error, setError] = useState(invalid || !token ? 'Ссылка недействительна или устарела' : '')
	const [done, setDone] = useState(false)
	const [busy, setBusy] = useState(false)
	const submit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (password.length < MIN_PASSWORD) return setError(`Пароль — минимум ${MIN_PASSWORD} символов`)
		if (password !== again) return setError('Пароли не совпадают')
		setBusy(true)
		setError('')
		const res = await post('reset-password', { newPassword: password, token })
		setBusy(false)
		if (res?.ok) return setDone(true)
		setError(!res ? 'Сервер недоступен' : res.status === 429 ? 'Слишком много попыток, подождите' : 'Ссылка недействительна или устарела')
	}
	return (
		<AuthFrame title="Новый пароль" footer={<Link href={done ? '/login' : '/forgot-password'} className="tb">{done ? 'Войти' : 'Запросить новую ссылку'}</Link>}>
			{done ? (
				<p className="mt-6 uppercase">&gt; Пароль изменён. Все устройства вышли из аккаунта — войдите с новым паролем</p>
			) : (
				<form onSubmit={submit}>
					<Field id="pw" label="Новый" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
					<Field id="pw2" label="Ещё раз" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
					<p className="mt-2 text-muted2">// Минимум {MIN_PASSWORD} символов</p>
					<button className="tb mt-6 h-12 w-full font-bold sm:h-auto" disabled={busy || !token || !password || !again}>{busy ? 'Сохраняю…' : 'Сохранить пароль'}</button>
					<Alert text={error} />
				</form>
			)}
		</AuthFrame>
	)
}
