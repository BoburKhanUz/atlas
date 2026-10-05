'use client'

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the
 * root layout, so no i18n provider/global CSS is guaranteed — keep it plain.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="uz">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F8F8F6',
          color: '#111111',
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Nimadir noto&apos;g&apos;ri ketdi
          </h1>
          <p style={{ color: '#6B7280', fontSize: 14, marginBottom: 20 }}>
            Sahifani yuklashda xatolik yuz berdi. Qayta urinib ko&apos;ring.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#0F766E',
              color: '#fff',
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
