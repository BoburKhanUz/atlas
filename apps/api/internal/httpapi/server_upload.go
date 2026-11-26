package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
	"time"

	"lookly/internal/apierr"
	"lookly/internal/httpapi/contract"
	"lookly/internal/idempotency"
	"lookly/internal/imaging"
	"lookly/internal/vision"
	"lookly/internal/wardrobe"
)

// The upload's limits, the Next.js API's: the whole request, and the
// picture in it.
const (
	UploadBodyLimit = 10 << 20
	MaxImageBytes   = 8 << 20
	// UploadTimeout is the upload's time: receiving the picture (a phone
	// on a slow connection), waiting for a processing slot, processing.
	UploadTimeout = 90 * time.Second
)

// The upload's own messages (the Next.js API's, but for the limits and the
// busy server, which it did not have).
const (
	msgNoContentLength = "So‘rov hajmi ko‘rsatilmagan"
	msgNotMultipart    = "multipart/form-data kutilgan"
	msgBadForm         = "Yaroqsiz forma ma’lumotlari"
	msgNoFile          = "Rasm fayli topilmadi"
	msgImageTooLarge   = "Rasm hajmi 8 MB dan oshmasligi kerak"
	msgReplayGone      = "Bu so‘rov bilan yaratilgan buyum o‘chirilgan"
	msgBusy            = "Server hozir band. Birozdan so‘ng qayta urinib ko‘ring."
)

var (
	msgWardrobeFull = fmt.Sprintf("Garderobingizda %d ta kiyim bor. Yangisini qo‘shish uchun avval keraksizlarini o‘chiring.", wardrobe.MaxItems)
	msgDailyUploads = fmt.Sprintf("Bugun %d ta rasm yukladingiz. Limit Toshkent vaqti bilan yarim tunda yangilanadi.", wardrobe.DailyUploads)
)

// busyRetryAfter is what a client is told to wait when the server could
// not take or process its picture now.
const busyRetryAfter = 15 * time.Second

// How many uploads are received and processed at a time. An upload holds
// its picture in memory from the first byte of the body to the answer, so
// the number of them is bounded before a body is read: the whole server's,
// and one user's (a phone sends one picture at a time; the second is a retry
// that overtook its first).
const (
	MaxUploadsInFlight = 16
	MaxUploadsPerUser  = 2
)

// inFlight counts the uploads being served.
type inFlight struct {
	mu      sync.Mutex
	total   int
	perUser map[string]int
}

// enter takes a place for an upload of the user's, if there is one; the
// caller leaves with the returned function.
func (f *inFlight) enter(userID string) (leave func(), ok bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.total >= MaxUploadsInFlight || f.perUser[userID] >= MaxUploadsPerUser {
		return nil, false
	}
	if f.perUser == nil {
		f.perUser = map[string]int{}
	}
	f.total++
	f.perUser[userID]++
	return func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.total--
		if f.perUser[userID]--; f.perUser[userID] == 0 {
			delete(f.perUser, userID)
		}
	}, true
}

func serverBusy() *apierr.Error {
	e := apierr.With(apierr.AiUnavailable, msgBusy)
	e.RetryAfter = busyRetryAfter
	return e
}

// declaredImageTypes are the types a picture may be sent as. What it is is
// decided by its bytes; HEIC, HEIF and AVIF are converted by the client.
var declaredImageTypes = []string{"image/jpeg", "image/jpg", "image/png", "image/webp"}

// UploadHeaders judges the headers of an upload before its body is read, in
// the Next.js API's order: the Idempotency-Key, the declared length (there
// must be one, within the limit), the form's type.
func UploadHeaders(r *http.Request) *apierr.Error {
	key, present, refusal := IdempotencyKey(r)
	if refusal != nil {
		return refusal
	}
	if present {
		r.Header.Set("Idempotency-Key", key) // as it counts: without the white space around it
	}
	switch {
	case r.ContentLength < 0:
		return apierr.With(apierr.PayloadTooLarge, msgNoContentLength)
	case r.ContentLength > UploadBodyLimit:
		return apierr.New(apierr.PayloadTooLarge)
	}
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data") {
		return apierr.With(apierr.UnsupportedMediaType, msgNotMultipart)
	}
	// A form of another type, or one whose parts cannot be told apart, is
	// no form.
	if mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mediaType != "multipart/form-data" || params["boundary"] == "" {
		return apierr.With(apierr.BadRequest, msgBadForm)
	}
	return nil
}

// CreateWardrobeItem: an uploaded picture becomes an item with its detected
// attributes. A retry with the same Idempotency-Key answers with the item
// the first request created.
func (s *Server) CreateWardrobeItem(ctx context.Context, request contract.CreateWardrobeItemRequestObject) (contract.CreateWardrobeItemResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	// Before a byte of the body is read.
	leave, ok := s.uploads.enter(id.UserID)
	if !ok {
		return nil, serverBusy()
	}
	defer leave()
	form, refusal := readUploadForm(request.Body)
	if refusal != nil {
		return nil, refusal
	}
	switch {
	case form.file == nil:
		return nil, apierr.With(apierr.BadRequest, msgNoFile)
	case !isDeclaredImage(form.file.contentType):
		return nil, apierr.New(apierr.UnsupportedImageFormat)
	case form.file.tooLarge:
		return nil, apierr.With(apierr.PayloadTooLarge, msgImageTooLarge)
	}
	up := wardrobe.Upload{
		UserID: id.UserID, File: form.file.data, FileName: form.file.name, HintName: form.file.name, Fields: form.fields,
	}
	if form.hint != "" {
		up.HintName = form.hint
	}
	if key := request.Params.IdempotencyKey; key != nil {
		up.IdempotencyKey = *key
	}
	created, err := s.s.Uploads.Create(ctx, up)
	if err != nil {
		return nil, uploadError(err)
	}
	return uploadResponse{
		body:     uploadBody{Item: s.itemBody(created.Item), Detection: detectionBodyOf(created.Detection)},
		replayed: created.Replayed,
	}, nil
}

func isDeclaredImage(contentType string) bool {
	declared := strings.ToLower(contentType)
	for _, t := range declaredImageTypes {
		if declared == t {
			return true
		}
	}
	return false
}

func uploadError(err error) error {
	var daily *wardrobe.DailyLimitError
	var busy *idempotency.InProgressError
	switch {
	case errors.Is(err, imaging.ErrUnsupported):
		return apierr.New(apierr.UnsupportedImageFormat)
	case errors.Is(err, imaging.ErrDimensions):
		return apierr.New(apierr.ImageDimensions)
	case errors.Is(err, imaging.ErrInvalid):
		return apierr.New(apierr.InvalidImage)
	case errors.Is(err, wardrobe.ErrWardrobeFull):
		// The contract has no code of its own for a full wardrobe; the
		// apps show a validation error's message as it is.
		return apierr.Validation(msgWardrobeFull)
	case errors.As(err, &daily):
		e := apierr.With(apierr.AiQuotaExceeded, msgDailyUploads)
		e.RetryAfter = daily.RetryAfter
		return e
	case errors.Is(err, idempotency.ErrMismatch):
		return apierr.New(apierr.IdempotencyKeyMismatch)
	case errors.As(err, &busy):
		e := apierr.New(apierr.IdempotencyInProgress)
		e.RetryAfter = busy.RetryAfter
		return e
	case errors.Is(err, idempotency.ErrClaimLost):
		// Another request with the key took this one's place while it
		// ran: that one answers; this one created nothing.
		e := apierr.New(apierr.IdempotencyInProgress)
		e.RetryAfter = 5 * time.Second
		return e
	case errors.Is(err, wardrobe.ErrReplayGone):
		return apierr.With(apierr.NotFound, msgReplayGone)
	case errors.Is(err, wardrobe.ErrNoUser):
		// The account was deleted after the gate let the request in.
		return apierr.New(apierr.Unauthorized)
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		// The picture could not be processed within the request's time
		// (every slot busy), or the request ended first: nothing was
		// stored; the client tries again.
		return serverBusy()
	}
	return err
}

// uploadedFile is the picture of an upload form.
type uploadedFile struct {
	name        string // as sent (the file name of the form's part)
	contentType string // as declared for the part
	data        []byte
	tooLarge    bool // over MaxImageBytes; data is not kept then
}

type uploadForm struct {
	// file is the form's "file" when that is a file (nil when the form has
	// none, or a text field of that name comes first).
	file *uploadedFile
	// fields are the text fields but those named "file"; of a repeated one,
	// the last (they are part of the request's identity).
	fields map[string]string
	// hint is the form's "filename" as the Next.js API reads it: the first
	// field of that name, when it is text.
	hint string
}

// formText is a name or a file name of a form's part as the Fetch API's
// FormData gives it: a browser writes a quote and the two line ends as
// percent escapes, those three only.
var formText = strings.NewReplacer("%22", `"`, "%0A", "\n", "%0a", "\n", "%0D", "\r", "%0d", "\r")

// readUploadForm reads a multipart form as the Fetch API's FormData reads
// it: a part with a file name is a file, any other a text field. A part
// must have a name. (Go's reader takes some spellings of a part's header
// that the Next.js API refused as a bad form: an unquoted name, a
// backslash-escaped quote, filename*. No client of ours writes them.)
func readUploadForm(reader *multipart.Reader) (uploadForm, *apierr.Error) {
	form := uploadForm{fields: map[string]string{}}
	bad := apierr.With(apierr.BadRequest, msgBadForm)
	seenFile, seenHint := false, false
	for {
		part, err := reader.NextPart()
		if err == io.EOF { // the end of the form itself (a body that breaks off wraps it: not errors.Is)
			return form, nil
		}
		if err != nil {
			return uploadForm{}, bad
		}
		mediaType, params, err := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		name, named := params["name"]
		if err != nil || mediaType != "form-data" || !named {
			return uploadForm{}, bad
		}
		name = formText.Replace(name)
		filename, isFile := params["filename"]
		switch {
		case isFile && name == "file" && !seenFile:
			seenFile = true
			data, err := io.ReadAll(io.LimitReader(part, MaxImageBytes+1))
			if err != nil {
				return uploadForm{}, bad
			}
			form.file = &uploadedFile{name: formText.Replace(filename), contentType: part.Header.Get("Content-Type"), data: data}
			if len(data) > MaxImageBytes {
				form.file.tooLarge, form.file.data = true, nil
			}
		case isFile:
			// Another file: not part of this request's meaning.
			if name == "filename" {
				seenHint = true // the first "filename" is no text: no hint
			}
		default:
			value, err := io.ReadAll(part) // within the request's body limit
			if err != nil {
				return uploadForm{}, bad
			}
			text := strings.ToValidUTF8(string(value), "�")
			if name == "file" {
				seenFile = true // the form's "file" is text: there is no picture
			} else {
				form.fields[name] = text
			}
			if name == "filename" && !seenHint {
				seenHint, form.hint = true, text
			}
		}
		if _, err := io.Copy(io.Discard, part); err != nil {
			return uploadForm{}, bad
		}
	}
}

// detectionBody is a detection in the Next.js API's shape.
type detectionBody struct {
	Category     string             `json:"category"`
	Subcategory  *string            `json:"subcategory"`
	Colors       []string           `json:"colors"`
	Pattern      *string            `json:"pattern"`
	Material     *string            `json:"material"`
	SleeveLength *string            `json:"sleeveLength"`
	Fit          *string            `json:"fit"`
	Style        *string            `json:"style"`
	Season       []string           `json:"season"`
	Gender       *string            `json:"gender"`
	Formality    *string            `json:"formality"`
	Confidence   map[string]float64 `json:"confidence"`
	Mock         bool               `json:"mock"`
}

func detectionBodyOf(d vision.Detection) detectionBody {
	return detectionBody{
		Category: d.Category, Subcategory: d.Subcategory, Colors: d.Colors, Pattern: d.Pattern, Material: d.Material,
		SleeveLength: d.SleeveLength, Fit: d.Fit, Style: d.Style, Season: d.Season, Gender: d.Gender, Formality: d.Formality,
		Confidence: d.Confidence, Mock: d.Mock,
	}
}

type uploadBody struct {
	Item      wardrobeItemBody `json:"item"`
	Detection detectionBody    `json:"detection"`
}

type uploadResponse struct {
	body     uploadBody
	replayed bool
}

func (r uploadResponse) VisitCreateWardrobeItemResponse(w http.ResponseWriter) error {
	if r.replayed {
		w.Header().Set("Idempotent-Replayed", "true")
	}
	return writeJSON(w, http.StatusCreated, r.body)
}
