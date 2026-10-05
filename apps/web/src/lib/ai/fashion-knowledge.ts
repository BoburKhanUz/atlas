/**
 * Fashion knowledge base — spec section 14 RAG.
 *
 * A structured TypeScript module (not a vector DB) containing styling rules:
 *   - color theory (warm/cool/neutral, seasonal palettes)
 *   - dress codes (casual / smart-casual / formal / black tie)
 *   - fabric characteristics (breathability, weight, season suitability)
 *   - body-shape styling principles
 *   - occasion styling (work / wedding / date / travel / casual)
 *
 * This is RAG-complements-structured-data: we use PostgreSQL for the user's
 * wardrobe, but the LLM also needs general fashion knowledge to explain WHY
 * a combination works. We retrieve relevant rules per question type.
 *
 * `retrieveKnowledge(question)` returns a compact context string for the
 * system prompt. Rules are tagged with topics so retrieval is keyword-based
 * (no vector embeddings needed for MVP).
 */

export interface KnowledgeRule {
  id: string
  topic:
    | 'color_theory'
    | 'dress_codes'
    | 'fabrics'
    | 'body_shape'
    | 'occasion'
    | 'seasonal'
    | 'combination'
  keywords: string[] // lower-case keywords for retrieval matching
  text: string // the rule statement, in Uzbek
}

const RULES: KnowledgeRule[] = [
  // ─── Color theory ──────────────────────────────────────────────────────────
  {
    id: 'color_warm_cool',
    topic: 'color_theory',
    keywords: ['rang', 'issiq', 'sovuq', 'neytral', 'undertone', 'ohang', 'teriTone'],
    text:
      'Issiq ohangdagi teri (sariq/oltin undertone) uchun — bej, krem, dolchin, qizil-jigarron, olivin, xantal, to\'q sariq. Sovuq ohang (pushti/ko\'k undertone) uchun — oq, kulrang, navy, marsala, bordo, zumrad, och ko\'k. Neytral ohang — har ikki oila ham mos keladi.',
  },
  {
    id: 'color_monochromatic',
    topic: 'color_theory',
    keywords: ['monoxromatik', 'bir rangli', 'tonal'],
    text:
      'Monoxromatik kombinatsiya — bitta rangning turli soyalari (masalan, och ko\'k + navy + oq ko\'k) — doimo uyg\'un, xavfsiz tanlov.',
  },
  {
    id: 'color_neutral_base',
    topic: 'color_theory',
    keywords: ['neytral', 'oq', 'qora', 'bej', 'kulrang'],
    text:
      'Neytral asos (oq, qora, bej, kulrang, navy) — boshqa rangni urg\'unlashtirish uchun ideal. 1 ta rangli kiyim + 2 neytral — universal formula.',
  },
  {
    id: 'color_complementary',
    topic: 'color_theory',
    keywords: ['qarama-qarshi', 'complementary', 'kontrast'],
    text:
      'Qarama-qarshi ranglar (ko\'k-to\'q sariq, yashil-qizil) — kundalikda jasur tanlov. Past to\'yinganlikda ishlaydi, to\'yingan + to\'yingan ko\'pincha ortiqcha.',
  },
  {
    id: 'color_3_rule',
    topic: 'color_theory',
    keywords: ['3 ta rang', 'uchta rang', 'maksimal rang'],
    text:
      'Bir outfitda 3 dan ortiq rang birlashtirmang. Neytral + 1 urg\'un rang + 1 aksent — eng xavfsiz.',
  },

  // ─── Dress codes ───────────────────────────────────────────────────────────
  {
    id: 'dress_casual',
    topic: 'dress_codes',
    keywords: ['casual', 'kasual', 'kundalik'],
    text:
      'Casual: futbolka + jins, krossovka yoki mokasin. Yengil matolar (paxta, zigit). Rang — xohlagan. Formality ball: 1/4.',
  },
  {
    id: 'dress_smart_casual',
    topic: 'dress_codes',
    keywords: ['smart-casual', 'smart_casual', 'ish'],
    text:
      'Smart-casual: oksford ko\'ylak + chinos (rubah yo\'q yoki och), desert boots yoki oq krossovka. Eng ko\'p ishlatiladigan dress code. Formality: 2/4.',
  },
  {
    id: 'dress_formal',
    topic: 'dress_codes',
    keywords: ['formal', 'kostyum', 'galstuk', 'ish'],
    text:
      'Formal: kostyum + oq/zardob ko\'ylak + galstuk (erkaklar) yoki klassik ko\'ylak + blazer (ayollar). Oksford poyabzal. Rang — neytral (navy, kulrang, qora). Formality: 3/4.',
  },
  {
    id: 'dress_black_tie',
    topic: 'dress_codes',
    keywords: ['black tie', 'smoking', 'to\'y', 'kechki'],
    text:
      'Black tie: smoking (erkak) yoki uzun kechki ko\'ylak (ayollar). Eng yuqori formality. Odatda to\'y, gala, mukofot marosimlari uchun. Formality: 4/4.',
  },

  // ─── Fabrics ───────────────────────────────────────────────────────────────
  {
    id: 'fabric_cotton',
    topic: 'fabrics',
    keywords: ['paxta', 'cotton', 'matn', 'nafas oladigan'],
    text:
      'Paxta — eng ko\'p ishlatiladigan. Nafas oladi, yengil, yozda ideal. Kam burish. Smart-casual va casual uchun universal.',
  },
  {
    id: 'fabric_linen',
    topic: 'fabrics',
    keywords: ['zigit', 'linen', 'issiq', 'yozgi'],
    text:
      'Zig\'ir — eng sovuq saqlovchi, yozning eng yaxshisi. Tez burushadi — bu uning xususiyati (casual estetika). Yoz + bahor uchun.',
  },
  {
    id: 'fabric_wool',
    topic: 'fabrics',
    keywords: ['jun', 'wool', 'qish', 'ilsiq', 'kashmir'],
    text:
      'Jun + Kashmir — issiq saqlaydi, qishning ideal materiallari. Kashmir junundan 6-8 martalik nozik va yumshoq. Smokin uchun juda mos.',
  },
  {
    id: 'fabric_denim',
    topic: 'fabrics',
    keywords: ['jins', 'denim', 'shim'],
    text:
      'Denim — juda chidamli, ko\'p holatda mos. Smart-casual (jins+oksford ko\'ylak) va formal-casual oralig\'ida ishlaydi.',
  },
  {
    id: 'fabric_silk',
    topic: 'fabrics',
    keywords: ['ipak', 'silk', 'kechki', 'formal'],
    text:
      'Ipak — yengil, lux, yaltiroq. Kechki tadbirlar va bayram uchun. Kundalikda kam ishlatiladi — formal darajasi baland.',
  },

  // ─── Body shape ────────────────────────────────────────────────────────────
  {
    id: 'body_pear',
    topic: 'body_shape',
    keywords: ['noksimon', 'pear', 'chegara', 'kele'],
    text:
      'Noksimon (yuqori ingichka, pastki keng): ustki ochiq rang, pastki qorong\'i. V-liniya yengi, A-yubka. Balans — yuqorini urg\'unlashtirish.',
  },
  {
    id: 'body_apple',
    topic: 'body_shape',
    keywords: ['olma', 'apple', 'qorin'],
    text:
      'Olma (qorin kengroq): ustki uzun, shim/koylak A kesim. V-yengi, rasching kamar. Neytral ustki + rangli pastki balansni yaxshilaydi.',
  },
  {
    id: 'body_hourglass',
    topic: 'body_shape',
    keywords: ['qumsoat', 'hourglass'],
    text:
      'Qumsoat (bel ingichka, yelka va son muvozanatli): belni urg\'unlashtiring. Wrap ko\'ylak, V-yengi, kamar. Eng mos tana shakli — ko\'p narsa mos keladi.',
  },
  {
    id: 'body_rectangle',
    topic: 'body_shape',
    keywords: ['to\'g\'ri', 'rectangle', 'burchak'],
    text:
      'To\'g\'ri (yelka, bel, son bir xil): belni soxta urg\'unlashtirish — kamar, peplum, A-yubka. Rang bloklari belni aniqlaydi.',
  },
  {
    id: 'body_inverted',
    topic: 'body_shape',
    keywords: ['mardumora', 'inverted_triangle', 'yelka'],
    text:
      'Mardumora (yelka keng, son ingichka): pastki urg\'unlashtiring — rangli shim, A-yubka. Ustki neytral + V yengi yelkani yumshatadi.',
  },

  // ─── Occasion ──────────────────────────────────────────────────────────────
  {
    id: 'occasion_work',
    topic: 'occasion',
    keywords: ['ish', 'work', 'ofis', 'kasbiy'],
    text:
      'Ish: smart-casual yoki formal. Neytral palitra (navy, kulrang, oq, bej). Galstuk yo\'q (open collar). Past yorqin ranglar. Oq krossovka yoki oksford.',
  },
  {
    id: 'occasion_wedding',
    topic: 'occasion',
    keywords: ['to\'y', 'wedding', 'bayram'],
    text:
      'To\'y: smart-casual+, ranglar — issiq va neytral (bej, krem, marsala, bordo, olivin). Oq libosdan saqlaning (kelinnikiga xurmat). Mavsumiy ranglardan foydalaning.',
  },
  {
    id: 'occasion_date',
    topic: 'occasion',
    keywords: ['uchrashuv', 'date', 'romantic'],
    text:
      'Uchrashuv: smart-casual, o\'ziga ishonchli. Issiq ranglar (bordo, qizil, xantal) ozgina — ko\'proq neytral. Aksessuar ehtiyotkor — kam, lekin aniq.',
  },
  {
    id: 'occasion_travel',
    topic: 'occasion',
    keywords: ['sayohat', 'travel', 'aviya'],
    text:
      'Sayohat: casual + amaliy. Neytral palitra (qora, kulrang, navy — dog\'larni yashiradi). Paxta + zigit aralash. Qulay oyoq kiyim — krossovka yoki mokasin.',
  },
  {
    id: 'occasion_casual',
    topic: 'occasion',
    keywords: ['casual', 'kundalik', 'sayr'],
    text:
      'Casual: har qanday mos kiyim. Erkin rang. Eng yengil materiallar. Krossovka + jins + futbolka — universal baza.',
  },

  // ─── Seasonal ──────────────────────────────────────────────────────────────
  {
    id: 'season_spring',
    topic: 'seasonal',
    keywords: ['bahor', 'spring'],
    text:
      'Bahor: o\'rta og\'irlik. Paxta + zigit + aralash. Ranglar — och yashil, och pushti, och ko\'k, bej, krem.',
  },
  {
    id: 'season_summer',
    topic: 'seasonal',
    keywords: ['yoz', 'summer', 'issiq'],
    text:
      'Yoz: eng yengil + nafas oladigan materiallar (zigit, paxta, ipak). Ranglar — yorqin, och, sovuq. Ochiq oyoq kiyim (sandalli). Qisqa yeng, qisqa shim.',
  },
  {
    id: 'season_autumn',
    topic: 'seasonal',
    keywords: ['kuz', 'autumn'],
    text:
      'Kuz: o\'rta + o\'rta-og\'ir. Zigit + jun + zigit-jun. Ranglar — olivin, xantal, dolchin, bordo, jigarron, zang.',
  },
  {
    id: 'season_winter',
    topic: 'seasonal',
    keywords: ['qish', 'winter', 'sovuq'],
    text:
      'Qish: eng og\'ir (jun, kashmir, zigir-jun). Ranglar — qorong\'i (qora, navy, jigarron, bordo). Kavatlar, palto, qalin botinka.',
  },

  // ─── Combination rules ─────────────────────────────────────────────────────
  {
    id: 'combo_top_bottom',
    topic: 'combination',
    keywords: ['ustki', 'pastki', 'ko\'ylak', 'shim'],
    text:
      'Ustki + pastki balansi: 1 ta yorqin + 1 neytral. Yoki ikkala neytral + 1 aksessuarga rang. Formal darajasi yaqin bo\'lishi kerak (smart_casual + smart_casual, formal + formal).',
  },
  {
    id: 'combo_shoes_match',
    topic: 'combination',
    keywords: ['poyabzal', 'oyoq kiyim', 'shoes', 'mos'],
    text:
      'Oyoq kiyim formality\'si ustki kiyimga mos: formal ko\'ylak → oksford. Smart-casual → desert/mokasin. Casual → krossovka. Oyoq rangi — belga mos (neytral poyabzal universal).',
  },
  {
    id: 'combo_layering',
    topic: 'combination',
    keywords: ['layer', 'blazer', 'kurtka', 'palto'],
    text:
      'Layering: bazasi (futbolka/ko\'ylak) + o\'rta (ko\'ylak-nitki/kardigan) + ust (blazer/kurtka/palto). Har bir qatlam formal darajada mos. Rang ketma-ketligi — eng to\'yingan ichkarida.',
  },
  {
    id: 'combo_accessories',
    topic: 'combination',
    keywords: ['aksessuar', 'soat', 'remen', 'sharf'],
    text:
      'Aksessuarlar: 3 tagacha maksimal (soat + remen + bitta boshqa). Hamma aksessuarlar metall rangi bitta (kumush/kumush, oltin/oltin — aralashtirma).',
  },
  {
    id: 'combo_pattern_mix',
    topic: 'combination',
    keywords: ['naqsh', 'pattern', 'gulli', 'chiziqli'],
    text:
      'Naqsh aralashtirish: 1 ta naqshli + 1 bir rangli — har doim xavfsiz. 2 naqshli faqat ekspertlar uchun (masalan, chiziqli ko\'ylak + katakli shim).',
  },
]

// ─── Retrieval ───────────────────────────────────────────────────────────────

/**
 * Retrieve relevant knowledge rules for a given user message.
 * Simple keyword matching — no vector embeddings needed for MVP.
 *
 * Returns at most 5 rules sorted by relevance (keyword overlap count).
 */
export function retrieveKnowledge(userMessage: string, max = 5): KnowledgeRule[] {
  const msg = userMessage.toLowerCase()
  const scored = RULES.map((rule) => {
    let score = 0
    for (const kw of rule.keywords) {
      if (msg.includes(kw)) score += 1
      // Partial keyword match (substring) — gentler
      if (kw.length > 4 && msg.includes(kw.slice(0, 4))) score += 0.3
    }
    return { rule, score }
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)

  return scored.map((s) => s.rule)
}

/**
 * Format retrieved rules as a compact context block for the system prompt.
 */
export function formatKnowledgeContext(rules: KnowledgeRule[]): string {
  if (rules.length === 0) return ''
  const lines = ['=== MODA BILIMLARI (RAG) ===']
  for (const r of rules) {
    lines.push(`• ${r.text}`)
  }
  return lines.join('\n')
}
