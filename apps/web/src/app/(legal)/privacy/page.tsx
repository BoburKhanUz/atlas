import type { Metadata } from 'next'
import { LegalDocumentView } from '@/components/legal/legal-document-view'
import { legalDocument } from '@/lib/legal/documents'

export const metadata: Metadata = { title: legalDocument('privacy').title }

export default function PrivacyPage() {
  return <LegalDocumentView id="privacy" />
}
