import '../../../core/network/api_error_code.dart';
import '../../../core/network/api_failure.dart';

/// Texts for failed sign-in / registration. For these screens a 401 means
/// wrong credentials (not an expired session) and a 409 an e-mail that is
/// already registered; the backend's own message is the most specific one.
String authFailureMessage(ApiFailure failure) {
  if (failure is ApiHttpFailure) {
    switch (failure.code) {
      case ApiErrorCode.unauthorized:
        return 'Email yoki parol noto‘g‘ri.';
      case ApiErrorCode.conflict:
        return 'Bu email allaqachon ro‘yxatdan o‘tgan. Kirish sahifasidan foydalaning.';
      case ApiErrorCode.validationError || ApiErrorCode.badRequest:
        return failure.fieldErrors.isNotEmpty ? failure.fieldErrors.first.message : failure.userMessage;
      default:
        return failure.userMessage;
    }
  }
  return failure.userMessage;
}

/// Client-side checks matching the contract (LoginRequest / RegisterRequest).
abstract final class AuthValidators {
  static final _email = RegExp(r'^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$');

  static String? email(String? value) {
    final v = value?.trim() ?? '';
    if (v.isEmpty) return 'Emailni kiriting';
    if (!_email.hasMatch(v)) return 'Email noto‘g‘ri ko‘rinishda';
    return null;
  }

  static String? loginPassword(String? value) {
    final v = value ?? '';
    if (v.isEmpty) return 'Parolni kiriting';
    if (v.length > 200) return 'Parol juda uzun';
    return null;
  }

  static String? newPassword(String? value) {
    final v = value ?? '';
    if (v.length < 8) return 'Parol kamida 8 belgidan iborat bo‘lsin';
    if (v.length > 200) return 'Parol juda uzun';
    return null;
  }

  static String? name(String? value) {
    final v = value?.trim() ?? '';
    if (v.length > 60) return 'Ism 60 belgidan oshmasin';
    return null;
  }
}
