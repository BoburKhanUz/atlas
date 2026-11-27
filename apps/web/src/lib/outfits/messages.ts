/**
 * The outfit routes' messages for the user (moved out of the routes
 * unchanged, so that the Go port reads the same texts: scripts/engine-copy.ts).
 */
import type { CompositionError, GenerateProblem } from '@/lib/ai/outfit-engine'

/** Why no outfit could be made, for the user. */
export const PROBLEM_MESSAGES: Record<GenerateProblem, string> = {
  empty_wardrobe: 'Garderobingiz bo‘sh. Avval kiyim qo‘shing — keyin sizga mos obrazlarni tavsiya qilamiz.',
  no_footwear: 'Outfit uchun oyoq kiyim kerak. Garderobingizga kamida bitta oyoq kiyim qo‘shing.',
  no_main_pieces: 'Outfit tuzish uchun yetarli kiyim yo‘q: ustki va pastki kiyim (yoki ko‘ylak-ayol) hamda oyoq kiyim qo‘shing.',
  nothing_suitable: 'Garderobingizdagi kiyimlar bugungi ob-havo yoki tadbirga mos kelmadi. Boshqa kiyimlar qo‘shib ko‘ring.',
}

/** Why a set of items cannot be saved as one outfit. */
export const COMPOSITION_MESSAGES: Record<CompositionError, string> = {
  duplicate_item: 'Bitta kiyim outfitda ikki marta bo‘lishi mumkin emas',
  unknown_category: 'Kiyim turi outfit uchun mos emas',
  missing_footwear: 'Outfitda oyoq kiyim bo‘lishi kerak',
  multiple_footwear: 'Outfitda bitta oyoq kiyim bo‘lishi kerak',
  missing_main: 'Outfitda ustki va pastki kiyim yoki ko‘ylak (ayol) bo‘lishi kerak',
  dress_with_top_or_bottom: 'Ko‘ylak (ayol) boshqa ustki yoki pastki kiyim bilan birga saqlanmaydi',
  multiple_primary: 'Har bir asosiy qismdan (ustki, pastki, ko‘ylak, ustki kiyim) bittadan bo‘lishi kerak',
  too_many_accessories: 'Aksessuarlar juda ko‘p',
}
