import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { register, sessionFromAuth } from '../lib/api'
import { setSession } from '../lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { FormField } from '../components/ui/form-field'

export function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError(t('auth.passwordTooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('auth.passwordsDoNotMatch'))
      return
    }
    setBusy(true)
    try {
      const auth = await register({
        email,
        password,
        display_name: displayName || undefined,
      })
      setSession(sessionFromAuth(auth))
      navigate('/overview', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.registerFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            {t('auth.createAccount')}
          </CardTitle>
          <CardDescription>
            {t('auth.registerNote1')}{' '}
            <code className="text-foreground">{t('enums.role.user')}</code>{' '}
            {t('auth.registerNote2')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <FormField label={t('auth.displayName')}>
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
              />
            </FormField>
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
            <FormField label={t('auth.password')}>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </FormField>
            <FormField label={t('auth.confirmPassword')}>
              <Input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </FormField>
            <Button type="submit" disabled={busy}>
              {busy ? t('auth.creatingAccount') : t('auth.register')}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {t('auth.haveAccount')}{' '}
              <Link to="/login" className="font-medium text-primary hover:underline">
                {t('auth.signIn')}
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
