// Runs one finished recording through a chosen tier, so either layer can be
// verified without dictating into the composer.
//
// It is the same one-shot call the bus relays (POST /voice/transcribe), with
// target=batch asking the accurate pass's model instead of the realtime one.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { transcribeSample } from '../../voice/api'

export function RecognitionTest({ target, label }: { target: 'realtime' | 'batch'; label: string }) {
  const { t } = useTranslation()
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const run = async (file: File) => {
    setTesting(true)
    setResult(null)
    try {
      const text = await transcribeSample(file, file.name, target)
      setResult(text || t('voiceAdmin.noText'))
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void run(file)
          }}
        />
        {testing ? t('tests.testing') : label}
      </label>
      {result !== null ? (
        <span className="text-xs text-muted-foreground">
          {t('voiceAdmin.testResult')}: <span className="text-foreground">{result}</span>
        </span>
      ) : null}
    </>
  )
}
