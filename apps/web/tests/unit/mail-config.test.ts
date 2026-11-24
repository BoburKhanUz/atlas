/** MAIL_TRANSPORT settings (src/server/mail-config.ts), checked at startup by assertServerConfig. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigError } from '@/lib/config'
import { mailEnabled, mailLinkOrigin, parseMailConfig } from '@/server/mail-config'

const MAIL_VARS = [
  'MAIL_TRANSPORT', 'MAIL_FROM', 'MAIL_OUTBOX_DIR', 'MAIL_ALLOW_OUTBOX_IN_PRODUCTION',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'PUBLIC_BASE_URL',
]

function env(vars: Record<string, string>) {
  for (const k of MAIL_VARS) vi.stubEnv(k, '')
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v)
}

const SMTP = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.uz', MAIL_FROM: 'ATLAS <no-reply@example.uz>' }

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseMailConfig', () => {
  it('defaults: outbox in development, disabled in production', () => {
    env({ NODE_ENV: 'development' })
    expect(parseMailConfig()).toMatchObject({ transport: 'outbox', from: 'Lookly <no-reply@localhost>' })
    expect(mailEnabled()).toBe(true)
    env({ NODE_ENV: 'production' })
    expect(parseMailConfig()).toEqual({ transport: 'disabled' })
    expect(mailEnabled()).toBe(false)
  })

  it('smtp: port 587 with STARTTLS required by default; 465 means TLS from the start', () => {
    env({ NODE_ENV: 'development', ...SMTP, SMTP_USER: 'u', SMTP_PASSWORD: 'p' })
    expect(parseMailConfig()).toEqual({
      transport: 'smtp', host: 'smtp.example.uz', port: 587, secure: false, requireTls: true, user: 'u', password: 'p', from: SMTP.MAIL_FROM,
    })
    env({ NODE_ENV: 'development', ...SMTP, SMTP_PORT: '465' })
    expect(parseMailConfig()).toMatchObject({ port: 465, secure: true, requireTls: false, user: null, password: null })
    // a relay on the same machine may speak plain SMTP
    env({ NODE_ENV: 'development', ...SMTP, SMTP_HOST: 'localhost', SMTP_PORT: '25' })
    expect(parseMailConfig()).toMatchObject({ secure: false, requireTls: false })
  })

  it.each([
    ['an unknown transport', { MAIL_TRANSPORT: 'sendgrid' }, /MAIL_TRANSPORT must be one of/],
    ['smtp without a host', { ...SMTP, SMTP_HOST: '' }, /SMTP_HOST/],
    ['smtp without MAIL_FROM', { ...SMTP, MAIL_FROM: '' }, /MAIL_FROM is not set/],
    ['a MAIL_FROM with a line break (header injection)', { ...SMTP, MAIL_FROM: 'a@b.uz\r\nBcc: x@y.uz' }, /one line/],
    ['a MAIL_FROM without an address', { ...SMTP, MAIL_FROM: 'ATLAS' }, /address/],
    ['a bad port', { ...SMTP, SMTP_PORT: '99999' }, /SMTP_PORT/],
    ['a user without a password', { ...SMTP, SMTP_USER: 'u' }, /both SMTP_USER and SMTP_PASSWORD/],
    ['a bad SMTP_SECURE', { ...SMTP, SMTP_SECURE: 'yes' }, /SMTP_SECURE/],
  ])('refuses %s', (_name, vars, message) => {
    env({ NODE_ENV: 'development', ...vars })
    expect(() => parseMailConfig()).toThrow(ConfigError)
    expect(() => parseMailConfig()).toThrow(message)
  })

  it('production: SMTP links need PUBLIC_BASE_URL, and the outbox needs an explicit acknowledgement', () => {
    env({ NODE_ENV: 'production', ...SMTP })
    expect(() => parseMailConfig()).toThrow(/PUBLIC_BASE_URL/)
    env({ NODE_ENV: 'production', ...SMTP, PUBLIC_BASE_URL: 'https://atlas.example.uz' })
    expect(parseMailConfig().transport).toBe('smtp')
    expect(mailLinkOrigin()).toBe('https://atlas.example.uz')
    env({ NODE_ENV: 'production', MAIL_TRANSPORT: 'outbox' })
    expect(() => parseMailConfig()).toThrow(/MAIL_ALLOW_OUTBOX_IN_PRODUCTION/)
    // e2e: the test reads the token from the file, whatever the link's origin
    env({ NODE_ENV: 'production', MAIL_TRANSPORT: 'outbox', MAIL_ALLOW_OUTBOX_IN_PRODUCTION: '1' })
    expect(parseMailConfig().transport).toBe('outbox')
  })

  it('development links use localhost when PUBLIC_BASE_URL is unset', () => {
    env({ NODE_ENV: 'development' })
    expect(mailLinkOrigin()).toBe('http://localhost:3000')
  })
})
