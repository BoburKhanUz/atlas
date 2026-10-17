import type { Metadata } from 'next'
import { LegalDocumentView } from '@/components/legal/legal-document-view'
import { legalDocument } from '@/lib/legal/documents'

export const metadata: Metadata = { title: legalDocument('terms').title }

export default function TermsPage() {
  return <LegalDocumentView id="terms" />
}
