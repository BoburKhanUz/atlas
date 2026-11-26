import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';
import '../data/photo_picker.dart';
import 'add_item_controller.dart';

/// Uzbek texts of the add-item flow.
abstract final class WardrobeMessages {
  /// A cancelled upload: the photo may already have reached the server.
  static const uploadCancelled =
      'Yuklash to‘xtatildi. Rasm serverga yetib borgan bo‘lishi mumkin — “Qayta urinish” kiyimni ikki marta qo‘shmaydi.';

  /// The server could not take or process the picture now (it is busy, or
  /// the analysis is down): the same upload can be sent again.
  static const uploadBusy = 'Xizmat hozir band. Birozdan so‘ng qayta urinib ko‘ring.';

  /// The text for an upload that failed and can be tried again.
  static String uploadFailed(ApiFailure? failure) => switch (failure) {
    CancelledFailure() => uploadCancelled,
    // Not the shared text for this code ("the AI service is down"): for an
    // upload it also means a busy server.
    ApiHttpFailure(code: ApiErrorCode.aiUnavailable) => uploadBusy,
    final f? => f.userMessage,
    null => 'Yuklab bo‘lmadi.',
  };

  static String reject(RejectReason r, {PhotoSource? source}) => switch (r) {
    RejectReason.tooSmall => 'Rasm juda kichik: qisqa tomoni kamida 256 px bo‘lishi kerak. Boshqa rasm tanlang.',
    RejectReason.dimensions =>
      'Rasm o‘lchami mos emas: qisqa tomoni kamida 256 px, tomonlari 8000 px dan oshmasin. Boshqa rasm tanlang.',
    RejectReason.tooLarge => 'Rasm juda katta (8 MB dan oshdi). Boshqa rasm tanlang.',
    RejectReason.unsupported => 'Bu rasm formati qo‘llab-quvvatlanmaydi. Boshqa rasm tanlang.',
    RejectReason.unreadable => 'Rasmni o‘qib bo‘lmadi. Boshqa rasm tanlang.',
    RejectReason.orientation => 'Rasmni to‘g‘ri burib bo‘lmadi. Boshqa rasm tanlang.',
    RejectReason.keyMismatch => 'Yuklashni qaytadan boshlash kerak. Rasmni yana bir bor tanlang.',
    RejectReason.notAGarment => 'Rasmda kiyim topilmadi. Kiyim, poyabzal, sumka yoki aksessuarni suratga oling.',
    RejectReason.multipleGarments => 'Rasmda bir nechta kiyim bor. Har bir kiyimni alohida suratga oling.',
    RejectReason.unclearPhoto => 'Rasm aniq emas. Kiyimni yorug‘ joyda, aniq qilib suratga oling.',
    RejectReason.aiQuota => 'Bugungi limit tugadi. Limit Toshkent vaqti bilan yarim tunda yangilanadi.',
    RejectReason.accessDenied =>
      source == PhotoSource.camera
          ? 'Kameraga ruxsat berilmagan. Sozlamalardan Lookly uchun kamerani yoqing.'
          : 'Rasmlarga ruxsat berilmagan. Sozlamalardan Lookly uchun rasmlarga ruxsat bering.',
  };
}
