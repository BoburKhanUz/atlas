import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { legalDocument, type LegalDocumentId } from '@/lib/legal/documents'
import { LEGAL_DRAFT, LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from '@/lib/legal/version'
import { routes } from '@/lib/routes'

const LIST_ITEM = '• '

type Block = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] }

/** Groups consecutive "• " paragraphs into one list. */
function toBlocks(paragraphs: string[]): Block[] {
  const blocks: Block[] = []
  for (const p of paragraphs) {
    if (!p.startsWith(LIST_ITEM)) {
      blocks.push({ kind: 'paragraph', text: p })
      continue
    }
    const last = blocks[blocks.length - 1]
    if (last?.kind === 'list') last.items.push(p.slice(LIST_ITEM.length))
    else blocks.push({ kind: 'list', items: [p.slice(LIST_ITEM.length)] })
  }
  return blocks
}

/** 2026-10-17 → 17.10.2026 */
function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}.${m}.${y}`
}

/**
 * The public /privacy and /terms pages: one document from src/lib/legal,
 * readable without an account (the register form links here).
 */
export function LegalDocumentView({ id }: { id: LegalDocumentId }) {
  const t = useTranslations('legal')
  const tCommon = useTranslations('common')
  const doc = legalDocument(id)
  const other = legalDocument(id === 'privacy' ? 'terms' : 'privacy')

  return (
    <main className="min-h-screen bg-background">
      <article className="max-w-2xl mx-auto px-6 py-12">
        <Link href={routes.home()} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          {tCommon('goHome')}
        </Link>

        <h1 className="display-lg text-foreground mt-6 mb-2">{doc.title}</h1>
        <p className="text-sm text-muted-foreground">
          {t('meta', { date: formatDate(LEGAL_EFFECTIVE_DATE), version: LEGAL_VERSION })}
        </p>

        {LEGAL_DRAFT && (
          <div
            role="note"
            className="text-sm text-foreground bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 mt-6"
          >
            {t('draft')}
          </div>
        )}

        {doc.sections.map((section) => (
          <section key={section.heading} className="mt-8">
            <h2 className="display-md text-foreground mb-3">{section.heading}</h2>
            <div className="space-y-3 text-sm text-foreground leading-relaxed">
              {toBlocks(section.paragraphs).map((block, i) =>
                block.kind === 'list' ? (
                  <ul key={i} className="list-disc pl-5 space-y-1.5">
                    {block.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p key={i}>{block.text}</p>
                ),
              )}
            </div>
          </section>
        ))}

        <p className="text-sm text-muted-foreground mt-12 pt-6 border-t">
          {t('seeAlso')}{' '}
          <Link href={other.id === 'privacy' ? routes.privacy() : routes.terms()} className="text-foreground underline underline-offset-2">
            {other.title}
          </Link>
        </p>
      </article>
    </main>
  )
}
