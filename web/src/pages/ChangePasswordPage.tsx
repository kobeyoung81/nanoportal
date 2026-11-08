import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { changeMyPassword } from '../lib/api'
import { getSession, setSession } from '../lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { FormField } from '../components/ui/form-field'

export function ChangePasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const forced = Boolean(getSession()?.must_change_password)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'))
      return
    }
    if (newPassword.length < 8) {
      setError(t('auth.passwordTooShort'))
      return
    }
    setBusy(true)
    try {
      await changeMyPassword(currentPassword, newPassword)
      const session = getSession()
      if (session) {
        setSession({ ...session, must_change_password: false })
      }
      toast.success(t('auth.passwordChanged'))
      navigate('/agent', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.changePasswordFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            {t('auth.changePasswordTitle')}
          </CardTitle>
          <CardDescription>
            {forced ? t('auth.changePasswordForced') : t('auth.changePasswordDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <FormField label={t('auth.currentPassword')}>
              <Input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                autoComplete="current-password"
                autoFocus
              />
            </FormField>
            <FormField label={t('auth.newPassword')}>
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                autoComplete="new-password"
              />
            </FormField>
            <FormField label={t('auth.confirmNewPassword')}>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                autoComplete="new-password"
              />
            </FormField>
            <Button type="submit" disabled={busy}>
              {busy ? t('auth.changingPassword') : t('auth.changePassword')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
