'use client'

import { useEffect } from 'react'
import { BRAND } from '@/lib/brand-colors'
import { reportClientError } from '@/lib/client-errors'

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the
 * root layout, so no i18n provider/global CSS is guaranteed — keep it plain.
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, 'react', true)
  }, [error])
  return (
    <html lang="uz">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BRAND.background,
          color: BRAND.textPrimary,
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Nimadir noto&apos;g&apos;ri ketdi
          </h1>
          <p style={{ color: BRAND.textSecondary, fontSize: 14, marginBottom: 20 }}>
            Sahifani yuklashda xatolik yuz berdi. Qayta urinib ko&apos;ring.
          </p>
          <button
            onClick={reset}
            style={{
              background: BRAND.accent,
              color: BRAND.onAccent,
              border: 0,
              borderRadius: 10,
              padding: '10px 20px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Qayta urinish
          </button>
        </div>
      </body>
    </html>
  )
}
