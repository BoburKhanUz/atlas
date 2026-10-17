import type { Metadata } from 'next'
import { ForgotPasswordScreen } from '@/components/auth/password-reset-screens'

export const metadata: Metadata = { title: 'Parolni tiklash' }

export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />
}
