/**
 * Deterministic synthetic "selfies" for colour-analysis tests: a background,
 * hair, a face ellipse with skin texture, two eyes and a mouth, rendered from
 * SVG and given seeded noise. No real person, no real photo.
 */
import sharp from 'sharp'

export interface SelfieSpec {
  width?: number
  height?: number
  skin?: string
  hair?: string | null
  eyes?: string | null
  background?: string
  /** Noise amplitude (0–255); 0 = flat colours. */
  noise?: number
  /** Face size relative to the image (1 = default). */
  faceScale?: number
  /** Moves the right eye down by this share of the face height (asymmetry). */
  eyeOffset?: number
  /** Large dark lenses over both eyes. */
  sunglasses?: boolean
  seed?: number
}

function lcg(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function selfieSvg(spec: SelfieSpec = {}): string {
  const w = spec.width ?? 600, h = spec.height ?? 800
  const k = spec.faceScale ?? 1
  const cx = w / 2, cy = h * 0.52
  const rx = w * 0.24 * k, ry = h * 0.25 * k
  const eyeY = cy - ry * 0.2, eyeDx = rx * 0.42, eyeR = rx * 0.11
  const hair = spec.hair
    ? `<ellipse cx="${cx}" cy="${cy - ry * 0.75}" rx="${rx * 1.12}" ry="${ry * 0.62}" fill="${spec.hair}"/>`
    : ''
  const eyes = spec.eyes
    ? [-1, 1]
        .map((s) => {
          const y = eyeY + (s > 0 ? (spec.eyeOffset ?? 0) * ry * 2 : 0)
          return `<ellipse cx="${cx + s * eyeDx}" cy="${y}" rx="${eyeR * 1.7}" ry="${eyeR}" fill="#f2f0ea"/>
           <circle cx="${cx + s * eyeDx}" cy="${y}" r="${eyeR * 0.9}" fill="${spec.eyes}"/>
           <circle cx="${cx + s * eyeDx}" cy="${y}" r="${eyeR * 0.35}" fill="#0b0b0b"/>`
        })
        .join('')
    : ''
  const glasses = spec.sunglasses
    ? [-1, 1].map((s) => `<ellipse cx="${cx + s * eyeDx}" cy="${eyeY}" rx="${rx * 0.36}" ry="${ry * 0.16}" fill="#151515"/>`).join('')
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="${spec.background ?? '#6f8fb0'}"/>
    <rect x="${cx - rx * 1.4}" y="${cy + ry * 0.95}" width="${rx * 2.8}" height="${h}" fill="#2c3e50"/>
    ${hair}
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${spec.skin ?? '#d9a37f'}"/>
    ${eyes}
    ${glasses}
    <ellipse cx="${cx}" cy="${cy + ry * 0.5}" rx="${rx * 0.3}" ry="${ry * 0.06}" fill="#9c4a4a"/>
  </svg>`
}

/** JPEG bytes of a synthetic selfie. */
export async function selfie(spec: SelfieSpec = {}): Promise<Buffer> {
  const { data, info } = await sharp(Buffer.from(selfieSvg(spec))).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const amp = spec.noise ?? 14
  if (amp > 0) {
    const rnd = lcg(spec.seed ?? 7)
    for (let i = 0; i < data.length; i += 3) {
      const n = (rnd() - 0.5) * 2 * amp
      for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round(data[i + c] + n)))
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer()
}
