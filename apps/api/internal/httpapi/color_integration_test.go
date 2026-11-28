//go:build integration

package httpapi_test

import (
	"bytes"
	"encoding/json"
	"image"
	stdcolor "image/color"
	"image/png"
	"net/http"
	"strings"
	"testing"

	"lookly/internal/color"
	"lookly/internal/golden"
	"lookly/internal/httpapi"
)

// The colour profile over HTTP with real PostgreSQL: a selfie is a golden
// canvas sent as a lossless PNG at the canvas's own size (so the server's
// canvas is the script's, byte for byte), and the answer is the Next.js
// analysis of it (testdata/golden/color.json).

const (
	analyzePath = "/api/v1/color-profile/analyze"
	profilePath = "/api/v1/color-profile"
)

func selfiePNG(t *testing.T, g golden.Color, name string) []byte {
	t.Helper()
	rgb, w, h := g.Canvas(t, name).Pixels(t, color.IsSkinPixel)
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := range w * h {
		img.Pix[i*4], img.Pix[i*4+1], img.Pix[i*4+2], img.Pix[i*4+3] = rgb[i*3], rgb[i*3+1], rgb[i*3+2], 255
	}
	return encodePNG(t, img)
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// flat is a picture of one colour.
func flat(t *testing.T, w, h int, c stdcolor.NRGBA) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = c.R, c.G, c.B, c.A
	}
	return encodePNG(t, img)
}

func analyzeCall(t *testing.T, m mobileSession, parts ...formPart) call {
	t.Helper()
	body, contentType := form(t, parts...)
	return call{path: analyzePath, mobile: true, bearer: m.accessToken, body: body, headers: map[string]string{"Content-Type": contentType}}
}

// wantProfile is the golden analysis as the route answers it.
func wantProfile(t *testing.T, g golden.Color, name string) map[string]any {
	t.Helper()
	var r map[string]any
	if err := json.Unmarshal(g.Canvas(t, name).Result.Value, &r); err != nil || r == nil {
		t.Fatalf("%s: not an analysed canvas", name)
	}
	out := map[string]any{}
	for _, k := range []string{"undertone", "undertoneConfidence", "season", "secondarySeason", "secondaryConfidence", "confidence",
		"contrastLevel", "recommendedColors", "neutralColors", "cautionColors", "skinTone", "hairColor", "eyeColor"} {
		out[k] = r[k]
	}
	return out
}

func sameProfile(t *testing.T, what string, got any, want map[string]any) {
	t.Helper()
	p, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("%s: %v", what, got)
	}
	for k, v := range want {
		if !jsonEqual(p[k], v) {
			t.Errorf("%s: %s = %v, want %v", what, k, p[k], v)
		}
	}
	if p["id"] == "" || p["analyzedAt"] == "" || len(p) != len(want)+2 {
		t.Errorf("%s: %v", what, p)
	}
}

func TestASelfieBecomesTheColourProfileShownAndDeleted(t *testing.T) {
	t.Parallel()
	g := golden.LoadColor(t)
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)

	// Nothing yet.
	none := a.do(call{method: http.MethodGet, path: profilePath, mobile: true, bearer: m.accessToken})
	a.is(none, http.StatusOK, "")
	if none.body["status"] != "not_analyzed" || none.body["colorProfile"] != nil || none.text("message") != "Rang tahlilisi hali amalga oshirilmadi. Selfie yuklang." {
		t.Fatalf("before: %s", none.raw)
	}

	got := a.do(analyzeCall(t, m, filePart("selfie.png", "image/png", selfiePNG(t, g, "largest"))))
	a.is(got, http.StatusOK, "")
	want := wantProfile(t, g, "largest")
	sameProfile(t, "analysed", got.body["colorProfile"], want)
	if got.text("disclaimer") != color.Disclaimer || len(got.body) != 2 {
		t.Errorf("analysed: %s", got.raw)
	}
	var stored struct {
		Analysis, Version, Recommended string
		Skin, Undertone                *string
	}
	if err := a.pool.QueryRow(t.Context(), `SELECT c."analysisJson", c."analysisVersion", c."recommendedColors", p."skinTone", p."skinUndertone"
		FROM "ColorProfile" c JOIN "UserProfile" p ON p."colorProfileId" = c."id" WHERE c."userId" = $1`, user).
		Scan(&stored.Analysis, &stored.Version, &stored.Recommended, &stored.Skin, &stored.Undertone); err != nil {
		t.Fatal(err)
	}
	var analysis map[string]any
	_ = json.Unmarshal(g.Canvas(t, "largest").Result.Value, &analysis)
	if !jsonEqualText(stored.Analysis, analysis["analysis"]) || stored.Version != color.Version || !jsonEqualText(stored.Recommended, want["recommendedColors"]) ||
		stored.Skin == nil || *stored.Skin != want["skinTone"] || stored.Undertone == nil || *stored.Undertone != want["undertone"] {
		t.Errorf("stored %+v", stored)
	}

	shown := a.do(call{method: http.MethodGet, path: profilePath, mobile: true, bearer: m.accessToken})
	a.is(shown, http.StatusOK, "")
	sameProfile(t, "shown", shown.body["colorProfile"], want)
	if shown.body["status"] != "analyzed" || shown.text("disclaimer") != color.Disclaimer ||
		shown.body["colorProfile"].(map[string]any)["id"] != got.body["colorProfile"].(map[string]any)["id"] {
		t.Errorf("shown %s", shown.raw)
	}

	// Another selfie replaces it: one profile per user.
	again := a.do(analyzeCall(t, m, filePart("selfie.png", "image/png", selfiePNG(t, g, "face scale 0.5"))))
	a.is(again, http.StatusOK, "")
	sameProfile(t, "replaced", again.body["colorProfile"], wantProfile(t, g, "face scale 0.5"))
	if n := query[int](a, `SELECT count(*)::int FROM "ColorProfile" WHERE "userId" = $1`, user); n != 1 {
		t.Errorf("%d colour profiles", n)
	}

	// Another user's profile is their own.
	other := a.mobileRegister(nil)
	if b := a.do(call{method: http.MethodGet, path: profilePath, mobile: true, bearer: other.accessToken}); b.body["status"] != "not_analyzed" {
		t.Errorf("the other user sees %s", b.raw)
	}

	for range 2 { // idempotent
		gone := a.do(call{method: http.MethodDelete, path: profilePath, mobile: true, bearer: m.accessToken})
		a.is(gone, http.StatusOK, "")
		if gone.body["ok"] != true {
			t.Errorf("delete %s", gone.raw)
		}
	}
	if b := a.do(call{method: http.MethodGet, path: profilePath, mobile: true, bearer: m.accessToken}); b.body["status"] != "not_analyzed" {
		t.Errorf("after the delete: %s", b.raw)
	}
	if n := query[int](a, `SELECT count(*)::int FROM "UserProfile" WHERE "userId" = $1 AND ("skinTone" IS NOT NULL OR "skinUndertone" IS NOT NULL
		OR "hairColor" IS NOT NULL OR "eyeColor" IS NOT NULL OR "colorProfileId" IS NOT NULL)`, user); n != 0 {
		t.Error("the selfie's values stay on the profile")
	}
	for _, e := range strings.Split(a.logs(), "\n") {
		if strings.Contains(e, `"msg":"ai.call"`) && !strings.Contains(e, `"feature":"color_analysis","provider":"deterministic","model":"color-analysis-v2","outcome":"ok"`) {
			t.Errorf("call event %s", e)
		}
	}
	if !strings.Contains(a.logs(), `"feature":"color_analysis"`) {
		t.Error("no call event")
	}
}

func jsonEqualText(text string, want any) bool {
	var got any
	return json.Unmarshal([]byte(text), &got) == nil && jsonEqual(got, want)
}

func TestASelfieThatCannotBeAnalysedStoresNothing(t *testing.T) {
	t.Parallel()
	g := golden.LoadColor(t)
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	// A profile from before stays as it was.
	a.is(a.do(analyzeCall(t, m, filePart("selfie.png", "image/png", selfiePNG(t, g, "largest")))), http.StatusOK, "")
	before := query[string](a, `SELECT "updatedAt"::text FROM "ColorProfile" WHERE "userId" = $1`, user)

	gif := picture(t, "images/picture.gif")
	for _, c := range []struct {
		name    string
		call    call
		status  int
		code    string
		message string
		reason  string
	}{
		{"flat", analyzeCall(t, m, filePart("s.png", "image/png", flat(t, 400, 500, stdcolor.NRGBA{0xe0, 0xac, 0x69, 255}))), 422, "PHOTO_QUALITY_TOO_LOW",
			"Rasmda tahlil uchun yetarli tafsilot yo‘q. Yuzingiz aniq ko‘rinadigan selfi oling.", "low_detail"},
		{"black", analyzeCall(t, m, filePart("s.png", "image/png", flat(t, 300, 300, stdcolor.NRGBA{0, 0, 0, 255}))), 422, "PHOTO_QUALITY_TOO_LOW",
			"Rasm juda qorong‘i. Yorug‘roq joyda, yuzingizga yorug‘lik tushadigan selfi oling.", "too_dark"},
		{"white", analyzeCall(t, m, filePart("s.png", "image/png", flat(t, 300, 300, stdcolor.NRGBA{255, 255, 255, 255}))), 422, "PHOTO_QUALITY_TOO_LOW",
			"Rasm juda yorug‘ (oqarib ketgan). To‘g‘ridan-to‘g‘ri quyosh yoki chiroqqa qaramasdan qayta oling.", "overexposed"},
		{"no skin", analyzeCall(t, m, filePart("s.png", "image/png", selfiePNG(t, g, "skin in two cells, under the central share"))), 422, "SKIN_NOT_VISIBLE", "", ""},
		{"too small", analyzeCall(t, m, filePart("s.png", "image/png", selfiePNG(t, g, "warm light"))), 422, "IMAGE_DIMENSIONS", "", ""},
		{"not a picture", analyzeCall(t, m, filePart("s.png", "image/png", []byte("not a picture at all"))), 422, "INVALID_IMAGE", "", ""},
		{"a GIF said to be a PNG", analyzeCall(t, m, filePart("s.png", "image/png", gif)), 422, "INVALID_IMAGE", "", ""},
		{"declared as a GIF", analyzeCall(t, m, filePart("s.gif", "image/gif", gif)), 422, "INVALID_IMAGE", "Faqat JPG, PNG yoki WEBP qo‘llab-quvvatlanadi", ""},
		{"too large", analyzeCall(t, m, filePart("s.png", "image/png", bytes.Repeat([]byte{1}, httpapi.MaxImageBytes+1))), 422, "INVALID_IMAGE", "Rasm 8 MB dan oshmasligi kerak", ""},
		{"no file", analyzeCall(t, m, textPart("note", "x")), 400, "BAD_REQUEST", "Rasm fayli topilmadi", ""},
		{"not a form", call{path: analyzePath, mobile: true, bearer: m.accessToken, body: `{}`, headers: map[string]string{"Content-Type": "application/json"}}, 415, "UNSUPPORTED_MEDIA_TYPE", "multipart/form-data kutilgan", ""},
		{"no session", call{path: analyzePath, mobile: true, body: "x", headers: map[string]string{"Content-Type": "multipart/form-data; boundary=x"}}, 401, "UNAUTHORIZED", "", ""},
	} {
		got := a.do(c.call)
		if got.status != c.status || got.text("code") != c.code || c.message != "" && got.text("error") != c.message {
			t.Errorf("%s: %d %s", c.name, got.status, got.raw)
			continue
		}
		if c.reason != "" {
			details, _ := got.body["details"].([]any)
			if len(details) != 1 || !jsonEqual(details[0], map[string]any{"path": "reason", "message": c.reason}) {
				t.Errorf("%s: details %v", c.name, got.body["details"])
			}
		}
	}
	if after := query[string](a, `SELECT "updatedAt"::text FROM "ColorProfile" WHERE "userId" = $1`, user); after != before {
		t.Error("a refused selfie changed the profile")
	}
	if !strings.Contains(a.logs(), `"outcome":"invalid_request"`) || !strings.Contains(a.logs(), `"outcome":"error"`) {
		t.Errorf("the refusals are not told to the monitoring: %s", a.logs())
	}
}
