/**
 * The privacy policy and the terms of use shown in the app (GET /api/v1/legal)
 * and on the public /privacy and /terms pages. Uzbek, plain paragraphs; a
 * paragraph starting with "• " is a list item.
 *
 * DRAFT (LEGAL_DRAFT): written from the actual data flows (docs/ai/privacy.md)
 * for counsel to review. Counsel fills the [bracketed] placeholders, decides
 * the open points (hosting location under the Law on Personal Data, Article
 * 27-1; cross-border transfers to the AI providers), then LEGAL_DRAFT becomes
 * false and LEGAL_VERSION changes.
 */
import { LEGAL_DRAFT, LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from './version'

export type LegalDocumentId = 'privacy' | 'terms'

export interface LegalSection {
  heading: string
  paragraphs: string[]
}

export interface LegalDocument {
  id: LegalDocumentId
  title: string
  sections: LegalSection[]
}

const PRIVACY: LegalDocument = {
  id: 'privacy',
  title: 'Maxfiylik siyosati',
  sections: [
    {
      heading: 'Kim ma’lumotlaringizni qayta ishlaydi',
      paragraphs: [
        'Lookly ilovasi va xizmatini [Kompaniya nomi] (keyingi o‘rinlarda “biz”) taqdim etadi. Ushbu siyosat Lookly ilovasi va veb-saytida shaxsga doir ma’lumotlaringiz qanday yig‘ilishi, ishlatilishi va himoyalanishini tushuntiradi.',
        'Savol va so‘rovlar uchun: [aloqa email manzili].',
      ],
    },
    {
      heading: 'Qanday ma’lumotlarni yig‘amiz',
      paragraphs: [
        '• Hisob: email manzilingiz, ixtiyoriy ismingiz va parolingiz. Parol faqat qaytarib bo‘lmaydigan xesh ko‘rinishida saqlanadi.',
        '• Profil va uslub: siz kiritgan uslub va rang afzalliklari, jins va bichim kabi ixtiyoriy profil ma’lumotlari.',
        '• Garderob: siz yuklagan kiyim rasmlari (asl nusxa va kichiklashtirilgan nusxalari), AI aniqlagan va siz tuzatgan belgilar: toifa, rang, mavsum va boshqalar.',
        '• Obrazlar: saqlagan obrazlaringiz, ularning nomlari va siz bergan baholar.',
        '• Stilist suhbatlari: stilistga yozgan xabarlaringiz va unga berilgan javoblar.',
        '• Rang profili: selfi asosida hisoblangan natija (fasl, ton va ranglar). Selfi faqat tahlil paytida serverda ishlanadi, hech qayerga yuborilmaydi va saqlanmaydi.',
        '• Joylashuv: ob-havo uchun ruxsat bersangiz, taxminiy joylashuvingiz (taxminan 1 km aniqlikkacha yaxlitlanadi) yoki siz tanlagan shahar. Joylashuv serverda hisobingizga bog‘lab saqlanmaydi; tanlagan shahringiz faqat qurilmangizda saqlanadi.',
        '• Texnik ma’lumotlar: kirish sessiyalari (qurilma nomi, ilova yoki brauzer turi). IP manzilingiz faqat suiiste’molni cheklash uchun vaqtincha ishlatiladi va saqlanmaydi. Xizmat jurnallariga xabarlaringiz, rasmlaringiz va email manzilingiz yozilmaydi.',
        '• Xatolar haqidagi hisobotlar: ilovada yoki veb-sahifada xato yuz bersa, uning texnik tavsifi (xato turi va matni, ilova versiyasi, qurilma va tizim turi, ochiq ekran) bizning serverimizga yuboriladi va xizmat jurnaliga yoziladi. Hisobotdan email manzillari, tokenlar va havola parametrlari olib tashlanadi; u hisobingizga bog‘lanmaydi va uchinchi tomonga berilmaydi.',
      ],
    },
    {
      heading: 'Ma’lumotlardan nima uchun foydalanamiz',
      paragraphs: [
        '• Xizmatni ko‘rsatish: kiyimlaringizni tahlil qilish, obraz tavsiya qilish, stilist javoblari va ob-havoga moslash.',
        '• Hisobingiz xavfsizligi: kirishni tekshirish, sessiyalarni boshqarish, parolni tiklash va suiiste’molni cheklash.',
        '• Xizmat sifati: xatolar haqidagi hisobotlar va AI so‘rovlarining texnik ko‘rsatkichlari (tezlik, xato turi, sarf). Bu ko‘rsatkichlarda shaxsiy kontent bo‘lmaydi.',
        'Ma’lumotlaringizni sotmaymiz va reklama uchun ishlatmaymiz.',
      ],
    },
    {
      heading: 'AI va boshqa xizmat ko‘rsatuvchilar',
      paragraphs: [
        'Ayrim funksiyalar uchun ma’lumotlar O‘zbekistondan tashqaridagi xizmat ko‘rsatuvchilarga yuboriladi:',
        '• OpenAI — kiyim rasmlarini tahlil qilish. Rasm yuborishdan oldin qayta kodlanadi, undan EXIF va GPS kabi metama’lumotlar olib tashlanadi; fayl nomi yuborilmaydi.',
        '• Google (Gemini API) — stilist javoblari va obraz izohlari. Unga xabaringiz, kiyimlaringizning katalog belgilari (masalan, “qora, jinsi shim, kuz”), uslub va rang afzalliklaringiz, rang profilingiz xulosasi, ob-havo va tadbir yuboriladi.',
        '• Open-Meteo — ob-havo. Unga faqat yaxlitlangan koordinatalar yuboriladi.',
        'Bu xizmatlarga ismingiz, email manzilingiz va ichki identifikatorlar yuborilmaydi. Stilistga yozgan matningiz esa o‘zgarishsiz yuboriladi: unga boshqa odamlarning shaxsiy ma’lumotlarini yozmang.',
        'Pullik API shartlariga ko‘ra OpenAI va Google bu ma’lumotlarni o‘z modellarini o‘qitish uchun ishlatmaydi. Ular suiiste’molni aniqlash uchun ma’lumotlarni cheklangan muddat saqlaydi: OpenAI — 30 kungacha, Google — 55 kun.',
        'Parolni tiklash xatlari pochta xizmati orqali yuboriladi: [pochta xizmati nomi va joylashuvi]. Unga faqat email manzilingiz va bir martalik havola beriladi.',
      ],
    },
    {
      heading: 'Saqlash muddati',
      paragraphs: [
        'Ma’lumotlaringiz hisobingiz mavjud bo‘lguncha saqlanadi. Kiyim, obraz va rang profilini istalgan vaqtda alohida o‘chirishingiz mumkin. Stilist suhbatlarini hozircha alohida o‘chirib bo‘lmaydi: ular hisob bilan birga o‘chiriladi.',
        'Hisobni o‘chirsangiz, barcha ma’lumotlaringiz va rasmlaringiz darhol o‘chiriladi. Zaxira nusxalardan ular [zaxira nusxalar saqlanish muddati] ichida o‘chib ketadi.',
        'Parolni tiklash havolasi 60 daqiqa amal qiladi va ishlatilgach o‘chiriladi. Xizmat jurnallari, jumladan xatolar haqidagi hisobotlar, [jurnallar saqlanish muddati] saqlanadi.',
      ],
    },
    {
      heading: 'Huquqlaringiz',
      paragraphs: [
        'Profil, garderob va obrazlaringizni ilovaning o‘zida ko‘rishingiz va tahrirlashingiz mumkin.',
        'Hisobingizni ilovada o‘chirishingiz mumkin: Profil → Hisobni o‘chirish.',
        'Boshqa so‘rovlar, masalan ma’lumotlaringiz nusxasi uchun [aloqa email manzili] ga yozing.',
      ],
    },
    {
      heading: 'Yosh chegarasi',
      paragraphs: ['Lookly faqat 18 yoshdan katta foydalanuvchilar uchun. 18 yoshga to‘lmagan bo‘lsangiz, ilovadan foydalanmang.'],
    },
    {
      heading: 'Xavfsizlik',
      paragraphs: [
        'Ma’lumotlar HTTPS orqali shifrlangan holda uzatiladi. Rasmlaringiz faqat sizga qisqa muddatli imzolangan havolalar orqali ko‘rsatiladi. Parollar xeshlanadi.',
        'Parolni tiklash havolasi bir martalik. Yangi parol o‘rnatilgach, barcha qurilmalardagi kirishlar yakunlanadi.',
      ],
    },
    {
      heading: 'Ma’lumotlar qayerda saqlanadi',
      paragraphs: ['Ma’lumotlaringiz [hosting provayderi] serverlarida saqlanadi. Serverlar joylashuvi: [server joylashuvi].'],
    },
    {
      heading: 'O‘zgarishlar',
      paragraphs: [
        'Siyosat o‘zgarsa, yangi versiyasi va sanasini shu yerda e’lon qilamiz. Muhim o‘zgarishlar haqida ilova orqali xabar beramiz va kerak bo‘lsa qayta rozilik so‘raymiz.',
      ],
    },
  ],
}

const TERMS: LegalDocument = {
  id: 'terms',
  title: 'Foydalanish shartlari',
  sections: [
    {
      heading: 'Xizmat haqida',
      paragraphs: [
        'Lookly — garderobingizdagi kiyimlar asosida obraz tavsiya qiluvchi va AI stilist bilan suhbatlashish imkonini beruvchi ilova. Tavsiyalar maslahat xarakterida.',
      ],
    },
    {
      heading: 'Kim foydalanishi mumkin',
      paragraphs: [
        'Lookly’dan faqat 18 yoshdan katta shaxslar foydalanishi mumkin. Ro‘yxatdan o‘tishda to‘g‘ri email kiriting va parolingizni hech kimga bermang. Hisobingizdagi harakatlar uchun o‘zingiz javobgarsiz.',
      ],
    },
    {
      heading: 'Siz yuklaydigan kontent',
      paragraphs: [
        'Faqat o‘zingizga tegishli yoki yuklashga huquqingiz bor rasmlarni yuklang. Boshqa odamlarning shaxsiy ma’lumotlarini, noqonuniy yoki haqoratli kontentni yuklamang.',
        'Rasmlaringiz sizniki bo‘lib qoladi. Biz ularni faqat xizmatni ko‘rsatish uchun ishlatamiz (Maxfiylik siyosatiga qarang).',
      ],
    },
    {
      heading: 'AI cheklovlari',
      paragraphs: [
        'AI tahlili va tavsiyalari xato bo‘lishi mumkin: kiyim belgilarini tekshiring va kerak bo‘lsa tuzating.',
        'Rang profili — taxminiy styling tavsiyasi, tibbiy yoki ilmiy xulosa emas.',
        'AI funksiyalarida kunlik foydalanish limitlari bor.',
      ],
    },
    {
      heading: 'Taqiqlangan harakatlar',
      paragraphs: [
        'Xizmatni buzishga, boshqa foydalanuvchilarning ma’lumotlariga kirishga, ommaviy avtomatlashtirilgan so‘rovlar yuborishga yoki xizmatni qonunga zid maqsadda ishlatishga urinmang.',
      ],
    },
    {
      heading: 'Hisobni o‘chirish va cheklash',
      paragraphs: [
        'Hisobingizni istalgan vaqtda ilovada o‘chirishingiz mumkin. Ushbu shartlar buzilsa, hisobni cheklashimiz yoki o‘chirishimiz mumkin.',
      ],
    },
    {
      heading: 'Javobgarlik',
      paragraphs: ['Xizmat “boricha” taqdim etiladi. [Javobgarlik chegaralari yurist tomonidan aniqlanadi.]'],
    },
    {
      heading: 'O‘zgarishlar va qo‘llaniladigan qonun',
      paragraphs: [
        'Shartlar o‘zgarsa, yangi versiyasi va sanasini e’lon qilamiz. Ushbu shartlarga O‘zbekiston Respublikasi qonunchiligi qo‘llaniladi.',
      ],
    },
    {
      heading: 'Aloqa',
      paragraphs: ['[aloqa email manzili]'],
    },
  ],
}

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [PRIVACY, TERMS]

export function legalDocument(id: LegalDocumentId): LegalDocument {
  return id === 'privacy' ? PRIVACY : TERMS
}

/** The GET /api/v1/legal body. */
export function legalBundle() {
  return { version: LEGAL_VERSION, effectiveDate: LEGAL_EFFECTIVE_DATE, draft: LEGAL_DRAFT, documents: [...LEGAL_DOCUMENTS] }
}
