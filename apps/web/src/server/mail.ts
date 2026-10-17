/**
 * Sends e-mail through the transport chosen by MAIL_TRANSPORT
 * (src/server/mail-config.ts). Messages carry one-time links: their bodies
 * and recipients are never logged.
 */
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import nodemailer, { type Transporter } from 'nodemailer'
import { parseMailConfig, type MailConfig } from '@/server/mail-config'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>
}

let testTransport: MailTransport | null = null

/** Tests: capture messages instead of sending them (null restores the configured transport). */
export function setMailTransportForTesting(transport: MailTransport | null) {
  testTransport = transport
}

type SmtpConfig = Extract<MailConfig, { transport: 'smtp' }>
let smtp: { key: string; transporter: Transporter } | null = null

function smtpTransporter(c: SmtpConfig): Transporter {
  const key = JSON.stringify(c)
  if (smtp?.key !== key) {
    smtp?.transporter.close()
    const transporter = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      requireTLS: c.requireTls,
      auth: c.user && c.password ? { user: c.user, pass: c.password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
    smtp = { key, transporter }
  }
  return smtp.transporter
}

/** Sends one message. Throws when the transport is disabled or the server refuses it. */
export async function sendMail(message: MailMessage): Promise<void> {
  if (testTransport) return testTransport.send(message)
  const c = parseMailConfig()
  switch (c.transport) {
    case 'disabled':
      throw new Error('mail transport is disabled')
    case 'outbox': {
      await fs.mkdir(c.dir, { recursive: true, mode: 0o700 })
      const file = path.join(c.dir, `${Date.now()}-${randomUUID()}.json`)
      const record = { from: c.from, ...message, createdAt: new Date().toISOString() }
      await fs.writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 })
      return
    }
    case 'smtp':
      await smtpTransporter(c).sendMail({ from: c.from, to: message.to, subject: message.subject, text: message.text, html: message.html })
      return
  }
}
