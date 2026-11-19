import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { login, sessionFromAuth } from '../lib/api'
import { setSession } from '../lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { FormField } from '../components/ui/form-field'

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const auth = await login(email, password)
      setSession(sessionFromAuth(auth))
      if (auth.must_change_password) {
        navigate('/change-password', { replace: true })
        return
      }
      navigate(searchParams.get('next') ?? '/agent', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <img
              src="/favicon.svg?v=2"
              alt=""
              aria-hidden="true"
              width={20}
              height={20}
              className="h-5 w-5 shrink-0 rounded-[5px]"
            />
            {t('auth.signInTitle')}
          </CardTitle>
          <CardDescription>{t('auth.signInDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <FormField label={t('auth.email')}>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                autoFocus
              />
            </FormField>
            <p className="text-xs text-muted-foreground">{t('auth.ldapHint')}</p>
            <FormField label={t('auth.password')}>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
              />
            </FormField>
            <Button type="submit" disabled={busy}>
              {busy ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {t('auth.noAccount')}{' '}
              <Link to="/register" className="font-medium text-primary hover:underline">
                {t('auth.register')}
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
