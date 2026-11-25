// Package apierr holds the contract's error codes: each code's HTTP status
// and its Uzbek user-facing message (one table, ADR 0003). Domain services
// return *Error; the HTTP layer turns it into the error envelope. Codes never
// change meaning; clients branch on the code, never on the message.
package apierr

import (
	"fmt"
	"net/http"
)

// Code is one of the contract's error codes (ErrorResponse.code).
type Code string

const (
	BadRequest               Code = "BAD_REQUEST"
	ValidationError          Code = "VALIDATION_ERROR"
	Unauthorized             Code = "UNAUTHORIZED"
	Forbidden                Code = "FORBIDDEN"
	NotFound                 Code = "NOT_FOUND"
	Conflict                 Code = "CONFLICT"
	PayloadTooLarge          Code = "PAYLOAD_TOO_LARGE"
	UnsupportedMediaType     Code = "UNSUPPORTED_MEDIA_TYPE"
	InvalidImage             Code = "INVALID_IMAGE"
	UnsupportedImageFormat   Code = "UNSUPPORTED_IMAGE_FORMAT"
	ImageDimensions          Code = "IMAGE_DIMENSIONS"
	IdempotencyKeyMismatch   Code = "IDEMPOTENCY_KEY_MISMATCH"
	IdempotencyInProgress    Code = "IDEMPOTENCY_IN_PROGRESS"
	RateLimited              Code = "RATE_LIMITED"
	Internal                 Code = "INTERNAL"
	InvalidToken             Code = "INVALID_TOKEN"
	SessionExpired           Code = "SESSION_EXPIRED"
	SessionRevoked           Code = "SESSION_REVOKED"
	RefreshReused            Code = "REFRESH_REUSED"
	SessionRace              Code = "SESSION_RACE"
	ClientMismatch           Code = "CLIENT_MISMATCH"
	SessionBusy              Code = "SESSION_BUSY"
	NotAGarment              Code = "NOT_A_GARMENT"
	AiQuotaExceeded          Code = "AI_QUOTA_EXCEEDED"
	AiUnavailable            Code = "AI_UNAVAILABLE"
	PhotoQualityTooLow       Code = "PHOTO_QUALITY_TOO_LOW"
	SkinNotVisible           Code = "SKIN_NOT_VISIBLE"
	AnalysisUnavailable      Code = "ANALYSIS_UNAVAILABLE"
	ResetTokenInvalid        Code = "RESET_TOKEN_INVALID"
	PasswordResetUnavailable Code = "PASSWORD_RESET_UNAVAILABLE"
	ConsentRequired          Code = "CONSENT_REQUIRED"
)

type entry struct {
	status  int
	message string
}

// table: status and default message per code. The messages are the ones the
// Next.js server sends (parity test until B7).
var table = map[Code]entry{
	BadRequest:               {http.StatusBadRequest, "Yaroqsiz so‘rov"},
	ValidationError:          {http.StatusBadRequest, "Ma’lumotlar noto‘g‘ri"},
	Unauthorized:             {http.StatusUnauthorized, "Avtorizatsiya talab qilinadi"},
	Forbidden:                {http.StatusForbidden, "Ruxsat yo‘q"},
	NotFound:                 {http.StatusNotFound, "Topilmadi"},
	Conflict:                 {http.StatusConflict, "Ziddiyat"},
	PayloadTooLarge:          {http.StatusRequestEntityTooLarge, "So‘rov hajmi juda katta"},
	UnsupportedMediaType:     {http.StatusUnsupportedMediaType, "Qo‘llab-quvvatlanmaydigan format"},
	InvalidImage:             {http.StatusUnprocessableEntity, "Rasm faylini o‘qib bo‘lmadi"},
	UnsupportedImageFormat:   {http.StatusUnsupportedMediaType, "Faqat JPG, PNG yoki WEBP rasmlar qabul qilinadi (HEIC emas)"},
	ImageDimensions:          {http.StatusUnprocessableEntity, "Rasm o‘lchami: eng kichik tomoni kamida 256 px, eng katta tomoni ko‘pi bilan 8000 px bo‘lishi kerak"},
	IdempotencyKeyMismatch:   {http.StatusConflict, "Bu Idempotency-Key boshqa so‘rov uchun ishlatilgan"},
	IdempotencyInProgress:    {http.StatusConflict, "Xuddi shu so‘rov hali bajarilmoqda. Birozdan so‘ng qayta urinib ko‘ring."},
	RateLimited:              {http.StatusTooManyRequests, "Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring."},
	Internal:                 {http.StatusInternalServerError, "Serverda xatolik yuz berdi. Keyinroq qayta urinib ko‘ring."},
	InvalidToken:             {http.StatusUnauthorized, "Sessiya topilmadi. Qayta kiring."},
	SessionExpired:           {http.StatusUnauthorized, "Sessiya muddati tugadi. Qayta kiring."},
	SessionRevoked:           {http.StatusUnauthorized, "Sessiya yakunlangan. Qayta kiring."},
	RefreshReused:            {http.StatusUnauthorized, "Xavfsizlik uchun sessiya yakunlandi. Qayta kiring."},
	SessionRace:              {http.StatusUnauthorized, "Sessiya boshqa so‘rov tomonidan yangilandi. Qayta urinib ko‘ring."},
	ClientMismatch:           {http.StatusUnauthorized, "Bu sessiya boshqa ilova turi uchun. Qayta kiring."},
	SessionBusy:              {http.StatusServiceUnavailable, "Server band. Birozdan so‘ng qayta urinib ko‘ring."},
	NotAGarment:              {http.StatusUnprocessableEntity, "Rasmda bitta kiyim aniq ko‘rinmadi. Bitta kiyimni yorug‘ joyda suratga oling."},
	AiQuotaExceeded:          {http.StatusTooManyRequests, "Bugungi AI limiti tugadi. Limit Toshkent vaqti bilan yarim tunda yangilanadi."},
	AiUnavailable:            {http.StatusServiceUnavailable, "AI xizmati hozir ishlamayapti. Birozdan so‘ng qayta urinib ko‘ring."},
	PhotoQualityTooLow:       {http.StatusUnprocessableEntity, "Rasm sifati tahlil uchun yetarli emas. Kunduzgi yorug‘likda, aniq selfi oling."},
	SkinNotVisible:           {http.StatusUnprocessableEntity, "Rasmda yuz terisi yetarlicha ko‘rinmadi. Yuzingiz to‘liq ko‘rinadigan selfi oling."},
	AnalysisUnavailable:      {http.StatusServiceUnavailable, "Rang tahlili hozir bajarilmadi. Birozdan so‘ng qayta urinib ko‘ring."},
	ResetTokenInvalid:        {http.StatusBadRequest, "Havola yaroqsiz yoki muddati tugagan. Parolni tiklashni qaytadan so‘rang."},
	PasswordResetUnavailable: {http.StatusServiceUnavailable, "Parolni tiklash hozircha ishlamayapti. Keyinroq qayta urinib ko‘ring."},
	ConsentRequired:          {http.StatusForbidden, "Maxfiylik siyosati va Foydalanish shartlari yangilandi. Davom etish uchun ularni ko‘rib chiqing va qabul qiling."},
}

// order is the contract's order (for Codes).
var order = []Code{
	BadRequest, ValidationError, Unauthorized, Forbidden, NotFound, Conflict, PayloadTooLarge, UnsupportedMediaType, InvalidImage, UnsupportedImageFormat, ImageDimensions, IdempotencyKeyMismatch, IdempotencyInProgress, RateLimited, Internal, InvalidToken, SessionExpired, SessionRevoked, RefreshReused, SessionRace, ClientMismatch, SessionBusy, NotAGarment, AiQuotaExceeded, AiUnavailable, PhotoQualityTooLow, SkinNotVisible, AnalysisUnavailable, ResetTokenInvalid, PasswordResetUnavailable, ConsentRequired,
}

// Codes returns every code, in the contract's order.
func Codes() []Code { return append([]Code(nil), order...) }

// Status is the HTTP status the contract documents for the code. An unknown
// code is a programming error and maps to 500.
func (c Code) Status() int {
	if e, ok := table[c]; ok {
		return e.status
	}
	return http.StatusInternalServerError
}

// Message is the code's default Uzbek message.
func (c Code) Message() string {
	if e, ok := table[c]; ok {
		return e.message
	}
	return table[Internal].message
}

// Detail points at one invalid field (VALIDATION_ERROR).
type Detail struct {
	Path    string
	Message string
}

// Error is a contract error: a code, the user-facing message and, for
// validation errors, the fields at fault.
type Error struct {
	Code    Code
	Message string
	Details []Detail
}

// New returns the code with its default message.
func New(code Code) *Error { return &Error{Code: code, Message: code.Message()} }

// Validation returns VALIDATION_ERROR with a specific Uzbek message (shown to
// the user) and the fields at fault.
func Validation(message string, details ...Detail) *Error {
	return &Error{Code: ValidationError, Message: message, Details: details}
}

// Status is the HTTP status of the error's code.
func (e *Error) Status() int { return e.Code.Status() }

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }
