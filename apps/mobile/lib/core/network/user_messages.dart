import '../session/signed_out_reason.dart';
import 'api_error_code.dart';
import 'api_failure.dart';

/// User-facing texts (Uzbek) for failures. Never contains exception text,
/// URLs or tokens.
abstract final class UserMessages {
  static const noNetwork = 'Internet aloqasi yo‘q. Ulanishni tekshirib, qayta urinib ko‘ring.';
  static const apiUnreachable = 'ATLAS serveriga ulanib bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.';
  static const timeout = 'Server javobi kechikdi. Qayta urinib ko‘ring.';
  static const insecure = 'Xavfsiz ulanish o‘rnatilmadi. Boshqa tarmoqdan urinib ko‘ring.';
  static const cancelled = 'So‘rov bekor qilindi.';
  static const unexpected = 'Kutilmagan javob olindi. Qayta urinib ko‘ring.';
  static const generic = 'Nimadir xato ketdi. Qayta urinib ko‘ring.';
  static const signInRequired = 'Davom etish uchun tizimga kiring.';
  static const secureStorage =
      'Sessiyani qurilmada xavfsiz saqlab bo‘lmadi. Qayta urinib ko‘ring yoki qurilmani qayta ishga tushiring.';

  /// Explanation shown on the sign-in screen, or null when none is needed.
  static String? forSignedOut(SignedOutReason reason) => switch (reason) {
    SignedOutReason.none || SignedOutReason.loggedOut => null,
    SignedOutReason.expired => 'Sessiya muddati tugadi. Iltimos, qayta kiring.',
    SignedOutReason.revoked => 'Sessiya yakunlangan. Iltimos, qayta kiring.',
    SignedOutReason.reused => 'Xavfsizlik uchun sessiya yakunlandi. Iltimos, qayta kiring.',
    SignedOutReason.clientMismatch ||
    SignedOutReason.raced ||
    SignedOutReason.rejected => 'Sessiya tugadi. Iltimos, qayta kiring.',
    SignedOutReason.storageUnavailable => 'Saqlangan sessiyani o‘qib bo‘lmadi. Iltimos, qayta kiring.',
    SignedOutReason.accountDeleted => 'Hisobingiz o‘chirildi.',
  };

  static String forHttp(ApiHttpFailure f) {
    final specific = switch (f.code) {
      ApiErrorCode.badRequest || ApiErrorCode.validationError => null,
      ApiErrorCode.unauthorized => 'Sessiya muddati tugadi. Iltimos, qayta kiring.',
      ApiErrorCode.forbidden => 'Bu amalga ruxsat yo‘q.',
      ApiErrorCode.notFound => 'Ma’lumot topilmadi. U o‘chirilgan bo‘lishi mumkin.',
      ApiErrorCode.conflict => null,
      ApiErrorCode.payloadTooLarge => 'Rasm juda katta. 8 MB dan kichik rasm tanlang.',
      ApiErrorCode.unsupportedMediaType ||
      ApiErrorCode.unsupportedImageFormat => 'Bu rasm formati qo‘llab-quvvatlanmaydi — JPEG, PNG yoki WebP tanlang.',
      ApiErrorCode.invalidImage => 'Rasmni o‘qib bo‘lmadi. Boshqa rasm tanlang.',
      ApiErrorCode.imageDimensions =>
        'Rasm o‘lchami mos emas: qisqa tomoni kamida 256 px, tomonlari 8000 px dan oshmasin.',
      ApiErrorCode.idempotencyKeyMismatch => 'Yuklash qayta boshlanishi kerak. Rasmni yana bir bor tanlang.',
      ApiErrorCode.idempotencyInProgress => 'Rasm hali qayta ishlanmoqda. Bir necha soniyadan so‘ng tekshiring.',
      ApiErrorCode.rateLimited => 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.',
      ApiErrorCode.internal => 'Serverda xatolik yuz berdi. Birozdan so‘ng qayta urinib ko‘ring.',
      ApiErrorCode.invalidToken ||
      ApiErrorCode.sessionExpired ||
      ApiErrorCode.sessionRevoked ||
      ApiErrorCode.refreshReused ||
      ApiErrorCode.clientMismatch => 'Sessiya tugadi. Iltimos, qayta kiring.',
      ApiErrorCode.sessionRace => 'Sessiya yangilanmoqda. Bir lahzadan so‘ng qayta urinib ko‘ring.',
      ApiErrorCode.sessionBusy => 'Server band. Bir necha soniyadan so‘ng qayta urinib ko‘ring.',
      ApiErrorCode.notAGarment => 'Rasmda bitta kiyim aniq ko‘rinmadi. Bitta kiyimni yorug‘ joyda suratga oling.',
      ApiErrorCode.aiQuotaExceeded =>
        'Bugungi AI tahlil limiti tugadi. Limit Toshkent vaqti bilan yarim tunda yangilanadi.',
      ApiErrorCode.aiUnavailable => 'AI tahlil xizmati hozir ishlamayapti. Birozdan so‘ng qayta urinib ko‘ring.',
      ApiErrorCode.unknown => null,
    };
    if (specific != null) return specific;
    // Validation and conflict errors: the backend's own message is the most
    // specific (it is written for users), as long as it looks like one.
    final server = f.serverMessage?.trim();
    if (server != null && server.isNotEmpty && server.length <= 200 && !_looksTechnical(server)) return server;
    return generic;
  }

  static bool _looksTechnical(String s) =>
      RegExp(r'Exception|Error:|stack|\bat \S+\.\w+\(|https?://|[{}<>]').hasMatch(s);
}
