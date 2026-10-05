import '../data/photo_picker.dart';
import 'add_item_controller.dart';

/// Uzbek texts of the add-item flow.
abstract final class WardrobeMessages {
  static String reject(RejectReason r, {PhotoSource? source}) => switch (r) {
    RejectReason.tooSmall => 'Rasm juda kichik: qisqa tomoni kamida 256 px bo‘lishi kerak. Boshqa rasm tanlang.',
    RejectReason.dimensions =>
      'Rasm o‘lchami mos emas: qisqa tomoni kamida 256 px, tomonlari 8000 px dan oshmasin. Boshqa rasm tanlang.',
    RejectReason.tooLarge => 'Rasm juda katta (8 MB dan oshdi). Boshqa rasm tanlang.',
    RejectReason.unsupported => 'Bu rasm formati qo‘llab-quvvatlanmaydi. Boshqa rasm tanlang.',
    RejectReason.unreadable => 'Rasmni o‘qib bo‘lmadi. Boshqa rasm tanlang.',
    RejectReason.orientation => 'Rasmni to‘g‘ri burib bo‘lmadi. Boshqa rasm tanlang.',
    RejectReason.keyMismatch => 'Yuklashni qaytadan boshlash kerak. Rasmni yana bir bor tanlang.',
    RejectReason.accessDenied =>
      source == PhotoSource.camera
          ? 'Kameraga ruxsat berilmagan. Sozlamalardan ATLAS uchun kamerani yoqing.'
          : 'Rasmlarga ruxsat berilmagan. Sozlamalardan ATLAS uchun rasmlarga ruxsat bering.',
  };
}
