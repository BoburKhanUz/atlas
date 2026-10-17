'use client'

import { useEffect } from 'react'
import { installClientErrorReporting } from '@/lib/client-errors'

/** Mounted once in the root layout: uncaught browser errors go to our server log. */
export function ClientErrorReporter() {
  useEffect(() => installClientErrorReporting(), [])
  return null
}
