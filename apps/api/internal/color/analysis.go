// Package color is the selfie colour analysis (color-analysis-v2), as the
// Next.js server does it (apps/web/src/lib/ai/color-analysis.ts):
// deterministic and in process, no model, no provider, no network. The
// selfie is decoded into a small canvas, measured and dropped; nothing of
// the image is returned or stored except the derived profile.
//
// Pipeline: photo quality (dark, overexposed, flat, blurry) → skin (a
// YCbCr mask inside the central region; only grid cells that are mostly
// skin; shadows, highlights and colour outliers trimmed; the colour in
// CIELAB) → undertone from the hue angle ("unknown" when the evidence is
// weak) → hair from the band above the skin, eyes only from two symmetric
// dark regions (unknown otherwise) → the season by distance to four
// prototypes, with a confidence from the margin, the quality, the sample
// and the agreement, under caps.
//
// A styling heuristic, not a measurement; there is no face detection. Held
// to the Next.js code by testdata/golden/color.json. The explicit float64
// conversions keep each step rounded as JavaScript rounds it (no fused
// multiply-add).
package color

import (
	"cmp"
	"errors"
	"math"
	"slices"

	"lookly/internal/catalog"
	"lookly/internal/platform"
)

// Version is the analysis's version, stored with each profile.
const Version = "color-analysis-v2"

// CanvasMaxSide bounds the canvas the analysis reads.
const CanvasMaxSide = 320

// The reasons a photo is refused.
type QualityProblem string

const (
	TooDark     QualityProblem = "too_dark"
	Overexposed QualityProblem = "overexposed"
	Blurry      QualityProblem = "blurry"
	LowDetail   QualityProblem = "low_detail"
	Background  QualityProblem = "background"
)

// PhotoQualityError: the photo decodes but is not good enough to analyse.
type PhotoQualityError struct{ Reason QualityProblem }

func (e *PhotoQualityError) Error() string { return "photo quality: " + string(e.Reason) }

// ErrSkinNotVisible: not enough skin is visible to measure a colour.
var ErrSkinNotVisible = errors.New("skin not visible")

// The thresholds (the Next.js QUALITY, SKIN, UNDERTONE_BOUNDS, CONFIDENCE).
const (
	minMeanLuma     = 50
	maxCrushedShare = 0.5
	maxMeanLuma     = 220
	maxClippedShare = 0.3
	minLumaStd      = 12
	minSharpness    = 12

	skinMinPixels       = 600
	skinMinCentralShare = 0.06
	skinCellShare       = 0.35
	skinMinCells        = 2
	skinBackgroundShare = 0.6
	skinMaxCellGap      = 15

	boundCool, boundNeutralCool, boundNeutralWarm, boundWarm = 41, 47, 53, 59

	confidenceMax       = 0.8
	undertoneMax        = 0.75
	undertoneMin        = 0.3
	seasonMin           = 0.3
	withoutUndertoneCap = 0.45
	withoutContrastCap  = 0.65
	hairMax             = 0.7
	hairMin             = 0.3
	eyeMax              = 0.5

	grid = 4
)

// ─── Colour maths ───────────────────────────────────────────────────────────

// Lab is a CIELAB colour (D65).
type Lab struct {
	L float64 `json:"L"`
	A float64 `json:"a"`
	B float64 `json:"b"`
}

func luma(r, g, b float64) float64 {
	return float64(float64(0.299*r)+float64(0.587*g)) + float64(0.114*b)
}

func lin(c float64) float64 {
	v := c / 255
	if v <= 0.04045 {
		return v / 12.92
	}
	return math.Pow((v+0.055)/1.055, 2.4)
}

func labF(t float64) float64 {
	if t > 0.008856 {
		return math.Cbrt(t)
	}
	return float64(7.787*t) + 16.0/116
}

// RGBToLab is an sRGB colour (0 to 255) in CIELAB (D65).
func RGBToLab(r, g, b uint8) Lab {
	R, G, B := lin(float64(r)), lin(float64(g)), lin(float64(b))
	x := (float64(float64(0.4124*R)+float64(0.3576*G)) + float64(0.1805*B)) / 0.95047
	y := float64(float64(0.2126*R)+float64(0.7152*G)) + float64(0.0722*B)
	z := (float64(float64(0.0193*R)+float64(0.1192*G)) + float64(0.9505*B)) / 1.08883
	fx, fy, fz := labF(x), labF(y), labF(z)
	return Lab{L: float64(116*fy) - 16, A: 500 * (fx - fy), B: 200 * (fy - fz)}
}

// Chroma is a colour's chroma.
func Chroma(c Lab) float64 { return math.Hypot(c.A, c.B) }

// HueAngle is a colour's hue angle in degrees, 0 to 360.
func HueAngle(c Lab) float64 { return math.Mod(math.Atan2(c.B, c.A)*180/math.Pi+360, 360) }

func deltaE(p, q Lab) float64 {
	dl, da, db := p.L-q.L, p.A-q.A, p.B-q.B
	return math.Sqrt(float64(float64(dl*dl)+float64(da*da)) + float64(db*db))
}

func clamp(v, lo, hi float64) float64 { return math.Min(hi, math.Max(lo, v)) }

func round2(v float64) float64 { return platform.RoundHalfUp(v*100) / 100 }

// IsSkinPixel is the skin test: a YCbCr and luma range.
func IsSkinPixel(r8, g8, b8 uint8) bool {
	r, g, b := float64(r8), float64(g8), float64(b8)
	y := luma(r, g, b)
	cb := float64(float64(128-float64(0.168736*r))-float64(0.331264*g)) + float64(0.5*b)
	cr := float64(float64(128+float64(0.5*r))-float64(0.418688*g)) - float64(0.081312*b)
	return y > 35 && y < 240 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && r > b
}

func mean(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

func std(values []float64) float64 {
	if len(values) < 2 {
		return 0
	}
	m := mean(values)
	squares := make([]float64, len(values))
	for i, v := range values {
		squares[i] = (v - m) * (v - m)
	}
	return math.Sqrt(mean(squares))
}

// quantile of sorted values: the element at floor(q·(n−1)).
func quantile(sorted []float64, q float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	return sorted[min(len(sorted)-1, max(0, int(math.Floor(q*float64(len(sorted)-1)))))]
}

func median(values []float64) float64 {
	sorted := slices.Clone(values)
	slices.Sort(sorted)
	return quantile(sorted, 0.5)
}

func meanLab(pixels []Lab) Lab {
	ls, as, bs := make([]float64, len(pixels)), make([]float64, len(pixels)), make([]float64, len(pixels))
	for i, p := range pixels {
		ls[i], as[i], bs[i] = p.L, p.A, p.B
	}
	return Lab{L: mean(ls), A: mean(as), B: mean(bs)}
}

// ─── Canvas and quality ─────────────────────────────────────────────────────

// Canvas is the picture analysed: rows of R, G, B bytes.
type Canvas struct {
	Width, Height int
	RGB           []byte
}

func (c Canvas) px(x, y int) (r, g, b uint8) {
	i := (y*c.Width + x) * 3
	return c.RGB[i], c.RGB[i+1], c.RGB[i+2]
}

// QualityMetrics are what the photo's quality is judged by.
type QualityMetrics struct {
	MeanLuma, LumaStd, CrushedShare, ClippedShare float64
	// Sharpness is the variance of the 4-neighbour Laplacian of the luma.
	Sharpness float64
}

// MeasureQuality measures a canvas.
func MeasureQuality(c Canvas) QualityMetrics {
	n := c.Width * c.Height
	lum := make([]float64, n)
	var sum float64
	crushed, clipped := 0, 0
	for i := range n {
		l := luma(float64(c.RGB[i*3]), float64(c.RGB[i*3+1]), float64(c.RGB[i*3+2]))
		lum[i] = l
		sum += l
		if l <= 10 {
			crushed++
		}
		if l >= 248 {
			clipped++
		}
	}
	m := sum / float64(n)
	var sq float64
	for _, l := range lum {
		sq += float64((l - m) * (l - m))
	}
	var lapSum, lapSq float64
	count := 0
	for y := 1; y < c.Height-1; y++ {
		for x := 1; x < c.Width-1; x++ {
			i := y*c.Width + x
			v := float64(4*lum[i]) - lum[i-1] - lum[i+1] - lum[i-c.Width] - lum[i+c.Width]
			lapSum += v
			lapSq += float64(v * v)
			count++
		}
	}
	q := QualityMetrics{MeanLuma: m, LumaStd: math.Sqrt(sq / float64(n)), CrushedShare: float64(crushed) / float64(n), ClippedShare: float64(clipped) / float64(n)}
	if count > 0 {
		lapMean := lapSum / float64(count)
		q.Sharpness = lapSq/float64(count) - float64(lapMean*lapMean)
	}
	return q
}

// AssessQuality refuses the first problem found, else gives a quality
// score from 0.6 to 1.
func AssessQuality(q QualityMetrics) (float64, error) {
	switch {
	case q.MeanLuma < minMeanLuma || q.CrushedShare > maxCrushedShare:
		return 0, &PhotoQualityError{TooDark}
	case q.MeanLuma > maxMeanLuma || q.ClippedShare > maxClippedShare:
		return 0, &PhotoQualityError{Overexposed}
	case q.LumaStd < minLumaStd:
		return 0, &PhotoQualityError{LowDetail}
	case q.Sharpness < minSharpness:
		return 0, &PhotoQualityError{Blurry}
	}
	margin := min(
		clamp((q.MeanLuma-minMeanLuma)/40, 0, 1),
		clamp((maxMeanLuma-q.MeanLuma)/40, 0, 1),
		clamp((maxClippedShare-q.ClippedShare)/0.2, 0, 1),
		clamp((q.Sharpness-minSharpness)/(minSharpness*3), 0, 1),
	)
	return 0.6 + float64(0.4*margin), nil
}

// ─── Skin ───────────────────────────────────────────────────────────────────

// Box is a region of the canvas, its edges included.
type Box struct{ Top, Bottom, Left, Right int }

// SkinRegion is the measured skin.
type SkinRegion struct {
	// Lab is the representative colour after the outliers are left out.
	Lab       Lab
	Luma      float64
	Pixels    int
	Cells     int
	Agreement float64 // between the cells' hue angles, 0 to 1
	Box       Box     // of the skin cells
}

type skinCell struct {
	pixels []Lab
	lumas  []float64
	gx, gy int
}

type skinPixel struct {
	p    Lab
	l    float64
	cell int
}

// MeasureSkin measures the skin of a canvas; *PhotoQualityError
// (background) or ErrSkinNotVisible when it cannot.
func MeasureSkin(c Canvas) (SkinRegion, error) {
	w, h := float64(c.Width), float64(c.Height)
	x0, x1 := int(math.Floor(w*0.15)), int(math.Ceil(w*0.85))
	y0, y1 := int(math.Floor(h*0.1)), int(math.Ceil(h*0.9))
	border := max(2, int(platform.RoundHalfUp(float64(min(c.Width, c.Height))*0.08)))
	central, centralSkin, edge, edgeSkin := 0, 0, 0, 0
	skin := make([]bool, c.Width*c.Height)
	for y := range c.Height {
		for x := range c.Width {
			s := IsSkinPixel(c.px(x, y))
			skin[y*c.Width+x] = s
			if x >= x0 && x < x1 && y >= y0 && y < y1 {
				central++
				if s {
					centralSkin++
				}
			}
			if x < border || x >= c.Width-border || y < border || y >= c.Height-border {
				edge++
				if s {
					edgeSkin++
				}
			}
		}
	}
	centralShare := float64(centralSkin) / float64(central)
	if float64(edgeSkin)/float64(edge) > skinBackgroundShare && centralShare > skinBackgroundShare {
		return SkinRegion{}, &PhotoQualityError{Background}
	}
	if centralSkin < skinMinPixels || centralShare < skinMinCentralShare {
		return SkinRegion{}, ErrSkinNotVisible
	}

	// Only grid cells that are mostly skin are skin regions.
	cellW, cellH := float64(x1-x0)/grid, float64(y1-y0)/grid
	var cells []skinCell
	for gy := range grid {
		for gx := range grid {
			cx0, cx1 := int(math.Floor(float64(x0)+float64(float64(gx)*cellW))), int(math.Floor(float64(x0)+float64(float64(gx+1)*cellW)))
			cy0, cy1 := int(math.Floor(float64(y0)+float64(float64(gy)*cellH))), int(math.Floor(float64(y0)+float64(float64(gy+1)*cellH)))
			cell := skinCell{gx: gx, gy: gy}
			total := 0
			for y := cy0; y < cy1; y++ {
				for x := cx0; x < cx1; x++ {
					total++
					if !skin[y*c.Width+x] {
						continue
					}
					r, g, b := c.px(x, y)
					cell.pixels = append(cell.pixels, RGBToLab(r, g, b))
					cell.lumas = append(cell.lumas, luma(float64(r), float64(g), float64(b)))
				}
			}
			if total > 0 && float64(len(cell.pixels))/float64(total) >= skinCellShare {
				cells = append(cells, cell)
			}
		}
	}
	if len(cells) < skinMinCells {
		return SkinRegion{}, ErrSkinNotVisible
	}

	// Anchor on the cells nearest the centre (where a selfie's face is):
	// cells much lighter or darker than them are another surface that only
	// passes the skin test (dark-brown hair, a wooden wall).
	const centre = float64(grid-1) / 2
	distance := func(cell skinCell) float64 { return math.Hypot(float64(cell.gx)-centre, float64(cell.gy)-centre) }
	byDistance := slices.Clone(cells)
	slices.SortStableFunc(byDistance, func(p, q skinCell) int { return cmp.Compare(distance(p), distance(q)) })
	cellL := func(cell skinCell) float64 {
		ls := make([]float64, len(cell.pixels))
		for i, p := range cell.pixels {
			ls[i] = p.L
		}
		return median(ls)
	}
	nearest := make([]float64, 0, 4)
	for _, cell := range byDistance[:min(4, len(byDistance))] {
		nearest = append(nearest, cellL(cell))
	}
	refL := median(nearest)
	anchored := cells[:0:0]
	for _, cell := range cells {
		if math.Abs(cellL(cell)-refL) <= skinMaxCellGap {
			anchored = append(anchored, cell)
		}
	}
	cells = anchored
	if len(cells) < skinMinCells {
		return SkinRegion{}, ErrSkinNotVisible
	}

	// Shadows and highlights by lightness, then colour outliers by their
	// distance to the median.
	var all []skinPixel
	for ci, cell := range cells {
		for i, p := range cell.pixels {
			all = append(all, skinPixel{p: p, l: cell.lumas[i], cell: ci})
		}
	}
	sortedL := make([]float64, len(all))
	for i, e := range all {
		sortedL[i] = e.p.L
	}
	slices.Sort(sortedL)
	lo, hi := quantile(sortedL, 0.1), quantile(sortedL, 0.95)
	var lit []skinPixel
	for _, e := range all {
		if e.p.L >= lo && e.p.L <= hi {
			lit = append(lit, e)
		}
	}
	as, bs := make([]float64, len(lit)), make([]float64, len(lit))
	for i, e := range lit {
		as[i], bs[i] = e.p.A, e.p.B
	}
	ma, mb := median(as), median(bs)
	dist := make([]float64, len(lit))
	for i, e := range lit {
		dist[i] = math.Abs(e.p.A-ma) + math.Abs(e.p.B-mb)
	}
	mad := math.Max(2, median(dist))
	var kept []skinPixel
	for i, e := range lit {
		if dist[i] <= 3*mad {
			kept = append(kept, e)
		}
	}
	if len(kept) < skinMinPixels/2 {
		return SkinRegion{}, ErrSkinNotVisible
	}

	keptLab, keptLuma := make([]Lab, len(kept)), make([]float64, len(kept))
	for i, e := range kept {
		keptLab[i], keptLuma[i] = e.p, e.l
	}
	// The agreement is judged before the colour outliers are left out,
	// which would silently drop a whole disagreeing region.
	var perCell []float64
	for ci := range cells {
		var pixels []Lab
		for _, e := range lit {
			if e.cell == ci {
				pixels = append(pixels, e.p)
			}
		}
		if len(pixels) >= 20 {
			perCell = append(perCell, HueAngle(meanLab(pixels)))
		}
	}
	hueStd := 10.0
	if len(perCell) >= 2 {
		hueStd = std(perCell)
	}
	keptShare := float64(len(kept)) / float64(max(1, len(lit)))
	minGX, maxGX, minGY, maxGY := grid, -1, grid, -1
	for _, cell := range cells {
		minGX, maxGX, minGY, maxGY = min(minGX, cell.gx), max(maxGX, cell.gx), min(minGY, cell.gy), max(maxGY, cell.gy)
	}
	return SkinRegion{
		Lab: meanLab(keptLab), Luma: mean(keptLuma), Pixels: len(kept), Cells: len(cells),
		Agreement: clamp(1-hueStd/10, 0, 1) * clamp((keptShare-0.5)/0.3, 0, 1),
		Box: Box{
			Top:    int(math.Floor(float64(y0) + float64(float64(minGY)*cellH))),
			Bottom: int(math.Floor(float64(y0)+float64(float64(maxGY+1)*cellH))) - 1,
			Left:   int(math.Floor(float64(x0) + float64(float64(minGX)*cellW))),
			Right:  int(math.Floor(float64(x0)+float64(float64(maxGX+1)*cellW))) - 1,
		},
	}, nil
}

// ─── Undertone, skin tone ───────────────────────────────────────────────────

// ClassifyUndertone is the undertone class of a skin hue angle.
func ClassifyUndertone(hue float64) string {
	switch {
	case hue < boundCool:
		return "cool"
	case hue < boundNeutralCool:
		return "neutral_cool"
	case hue < boundNeutralWarm:
		return "neutral"
	case hue < boundWarm:
		return "neutral_warm"
	}
	return "warm"
}

// UndertoneMargin is how many degrees a hue is from the nearest class
// boundary.
func UndertoneMargin(hue float64) float64 {
	return min(math.Abs(hue-boundCool), math.Abs(hue-boundNeutralCool), math.Abs(hue-boundNeutralWarm), math.Abs(hue-boundWarm))
}

// ClassifySkinTone is the skin tone of a lightness.
func ClassifySkinTone(L float64) string {
	switch {
	case L >= 68:
		return "light"
	case L >= 57:
		return "medium"
	case L >= 45:
		return "tan"
	}
	return "deep"
}

// ─── Hair and eyes (unknown unless the evidence is clear) ───────────────────

// Feature is the hair's or the eyes' colour; Color nil is unknown.
type Feature struct {
	Color      *string
	Lab        *Lab
	Confidence float64
}

// HairColorOf names a hair colour.
func HairColorOf(c Lab) string {
	C, h := Chroma(c), HueAngle(c)
	switch {
	case C < 12 && c.L >= 55:
		return "gray"
	case c.L < 22:
		return "black"
	case h < 50 && C >= 22 && c.L < 55:
		return "rust"
	case c.L < 40:
		return "brown"
	case c.L < 58:
		return "tan"
	}
	return "beige"
}

func known(name string, lab Lab, confidence float64) Feature {
	return Feature{Color: &name, Lab: &lab, Confidence: confidence}
}

// MeasureHair measures the band right above the skin; unknown when it
// looks like the background.
func MeasureHair(c Canvas, skin SkinRegion) Feature {
	faceTop := skin.Box.Top
	bandH := int(platform.RoundHalfUp(float64(c.Height) * 0.15))
	top := max(0, faceTop-bandH)
	if faceTop-top < 3 {
		return Feature{}
	}
	left, right := int(math.Floor(float64(c.Width)*0.3)), int(math.Ceil(float64(c.Width)*0.7))
	var band []Lab
	total := 0
	for y := top; y < faceTop; y++ {
		for x := left; x < right; x++ {
			total++
			r, g, b := c.px(x, y)
			if luma(float64(r), float64(g), float64(b)) > 210 {
				continue
			}
			lab := RGBToLab(r, g, b)
			// The forehead: close to the measured skin colour.
			if deltaE(lab, skin.Lab) < 12 {
				continue
			}
			// Hair is low in chroma or red to yellow; blue, green and purple
			// are background or clothing.
			if h := HueAngle(lab); Chroma(lab) >= 15 && (h < 15 || h > 95) {
				continue
			}
			band = append(band, lab)
		}
	}
	coverage := float64(len(band)) / float64(max(1, total))
	if len(band) < 40 || coverage < 0.3 {
		return Feature{}
	}
	sorted := slices.Clone(band)
	slices.SortStableFunc(sorted, func(p, q Lab) int { return cmp.Compare(p.L, q.L) })
	trimmed := sorted[:max(1, int(math.Floor(float64(len(sorted))*0.9)))] // the highlights left out
	lab := meanLab(trimmed)
	ls := make([]float64, len(trimmed))
	for i, p := range trimmed {
		ls[i] = p.L
	}
	spread := std(ls)
	// The same rows at the image's edges are background: hair that matches
	// them cannot be told apart.
	var edge []Lab
	ew := max(2, int(platform.RoundHalfUp(float64(c.Width)*0.08)))
	for y := top; y < faceTop; y++ {
		for x := range ew {
			edge = append(edge, RGBToLab(c.px(x, y)), RGBToLab(c.px(c.Width-1-x, y)))
		}
	}
	if len(edge) > 0 && deltaE(lab, meanLab(edge)) < 10 {
		return Feature{}
	}
	confidence := round2(math.Min(hairMax, coverage*clamp(1-spread/25, 0, 1)))
	if confidence < hairMin {
		return Feature{}
	}
	return known(HairColorOf(lab), lab, confidence)
}

// EyeColorOf names an eye colour.
func EyeColorOf(c Lab) string {
	switch {
	case c.B < -4 && c.L > 25:
		return "blue"
	case c.A < -3 && c.B > 4:
		return "green"
	case Chroma(c) < 8 && c.L > 40:
		return "gray"
	}
	return "brown"
}

type eyeSide struct {
	n, total int
	sx, sy   float64
	pixels   []eyePixel
}

type eyePixel struct {
	lab Lab
	l   float64
}

// MeasureEyes finds the eyes only when two dark regions sit symmetrically
// where eyes would be inside the skin region; anything less clear is
// unknown, never a guessed colour.
func MeasureEyes(c Canvas, skin SkinRegion) Feature {
	top, bottom, left, right := skin.Box.Top, skin.Box.Bottom, skin.Box.Left, skin.Box.Right
	fw, fh := right-left+1, bottom-top+1
	if fw < 40 || fh < 50 {
		return Feature{}
	}
	y0 := int(math.Floor(float64(top) + float64(0.25*float64(fh))))
	y1 := int(math.Ceil(float64(top) + float64(0.5*float64(fh))))
	mid := float64(left) + float64(fw)/2
	dark := skin.Luma * 0.7
	side := func(x0, x1 float64) eyeSide {
		var s eyeSide
		for y := y0; y < y1; y++ {
			for x := int(math.Floor(x0)); x < int(math.Ceil(x1)); x++ {
				s.total++
				r, g, b := c.px(x, y)
				l := luma(float64(r), float64(g), float64(b))
				if IsSkinPixel(r, g, b) || l >= dark {
					continue
				}
				s.n++
				s.sx += float64(x)
				s.sy += float64(y)
				s.pixels = append(s.pixels, eyePixel{lab: RGBToLab(r, g, b), l: l})
			}
		}
		return s
	}
	ffw := float64(fw)
	L := side(float64(left)+float64(0.1*ffw), mid-float64(0.05*ffw))
	R := side(mid+float64(0.05*ffw), float64(right)-float64(0.1*ffw))
	share := func(s eyeSide) float64 { return float64(s.n) / float64(max(1, s.total)) }
	for _, s := range []eyeSide{L, R} {
		if s.n < 6 || share(s) < 0.01 || share(s) > 0.2 {
			return Feature{}
		}
	}
	if max(L.n, R.n) > 3*min(L.n, R.n) {
		return Feature{}
	}
	ly, ry := L.sy/float64(L.n), R.sy/float64(R.n)
	if math.Abs(ly-ry) > 0.08*float64(fh) {
		return Feature{}
	}
	dl, dr := mid-L.sx/float64(L.n), R.sx/float64(R.n)-mid
	if dl <= 0 || dr <= 0 || math.Abs(dl-dr) > 0.25*math.Max(dl, dr) {
		return Feature{}
	}
	// The iris: the darkest 30 % (pupils, lashes) left out.
	all := append(slices.Clone(L.pixels), R.pixels...)
	slices.SortStableFunc(all, func(p, q eyePixel) int { return cmp.Compare(p.l, q.l) })
	iris := all[int(math.Floor(float64(len(all))*0.3)):]
	if len(iris) < 4 {
		return Feature{}
	}
	labs := make([]Lab, len(iris))
	for i, p := range iris {
		labs[i] = p.lab
	}
	lab := meanLab(labs)
	return known(EyeColorOf(lab), lab, eyeMax)
}

// ─── Contrast and season ────────────────────────────────────────────────────

// Contrast is the lightness contrast between the skin and the hair or eyes.
type Contrast struct {
	Level string  `json:"level"`
	Value float64 `json:"value"`
}

// ContrastOf is the contrast, or nil when neither hair nor eyes are known.
func ContrastOf(skin Lab, hair, eyes *Lab) *Contrast {
	var diffs []float64
	if hair != nil {
		diffs = append(diffs, math.Abs(skin.L-hair.L))
	}
	if eyes != nil {
		diffs = append(diffs, 0.8*math.Abs(skin.L-eyes.L))
	}
	if len(diffs) == 0 {
		return nil
	}
	value := slices.Max(diffs)
	level := "low"
	switch {
	case value >= 40:
		level = "high"
	case value >= 22:
		level = "medium"
	}
	return &Contrast{Level: level, Value: value}
}

// The seasons, in the prototypes' order.
var seasons = []string{"spring", "summer", "autumn", "winter"}

type prototype struct{ warmth, lightness, chroma, contrast float64 }

// The prototypes on warmth, lightness, chroma (clear or muted) and
// contrast, each from −1 to 1.
var prototypes = map[string]prototype{
	"spring": {0.8, 0.6, 0.6, 0},
	"summer": {-0.8, 0.6, -0.6, -0.6},
	"autumn": {0.8, -0.5, -0.4, 0},
	"winter": {-0.8, -0.4, 0.6, 0.8},
}

const (
	weightWarmth, weightLightness, weightChroma, weightContrast = 0.4, 0.25, 0.15, 0.2
	softmaxT                                                    = 0.25
)

// SeasonFeatures are the evidence for a season.
type SeasonFeatures struct {
	// Warmth is nil when the undertone is unknown.
	Warmth    *float64 `json:"warmth"`
	Lightness float64  `json:"lightness"`
	Chroma    float64  `json:"chroma"`
	// Contrast is nil when neither hair nor eyes are known.
	Contrast *float64 `json:"contrast"`
}

// SeasonFeaturesOf is the evidence of a skin colour, the hair and the
// contrast (nil when unknown).
func SeasonFeaturesOf(skin Lab, undertoneKnown bool, hair *Lab, contrast *float64) SeasonFeatures {
	skinLight := clamp((skin.L-58)/14, -1, 1)
	f := SeasonFeatures{Lightness: skinLight, Chroma: clamp((Chroma(skin)-20)/8, -1, 1)}
	if undertoneKnown {
		w := clamp((HueAngle(skin)-50)/9, -1, 1)
		f.Warmth = &w
	}
	if hair != nil {
		f.Lightness = float64(0.75*skinLight) + float64(0.25*clamp((hair.L-35)/25, -1, 1))
	}
	if contrast != nil {
		v := clamp((*contrast-28)/20, -1, 1)
		f.Contrast = &v
	}
	return f
}

// Probability is a season's probability.
type Probability struct {
	Season string  `json:"season"`
	P      float64 `json:"p"`
}

// SeasonProbabilities are the four seasons' probabilities (a softmax of the
// negative weighted distance), the most likely first.
func SeasonProbabilities(f SeasonFeatures) []Probability {
	type dim struct {
		weight float64
		value  float64
		of     func(prototype) float64
	}
	var dims []dim
	if f.Warmth != nil {
		dims = append(dims, dim{weightWarmth, *f.Warmth, func(p prototype) float64 { return p.warmth }})
	}
	dims = append(dims, dim{weightLightness, f.Lightness, func(p prototype) float64 { return p.lightness }},
		dim{weightChroma, f.Chroma, func(p prototype) float64 { return p.chroma }})
	if f.Contrast != nil {
		dims = append(dims, dim{weightContrast, *f.Contrast, func(p prototype) float64 { return p.contrast }})
	}
	wsum := 0.0
	for _, d := range dims {
		wsum += d.weight
	}
	scores := make([]float64, len(seasons))
	for i, season := range seasons {
		d := 0.0
		for _, dm := range dims {
			diff := dm.value - dm.of(prototypes[season])
			d += float64(dm.weight * float64(diff*diff))
		}
		scores[i] = -(d / wsum) / softmaxT
	}
	top := slices.Max(scores)
	exps := make([]float64, len(scores))
	total := 0.0
	for i, s := range scores {
		exps[i] = math.Exp(s - top)
		total += exps[i]
	}
	out := make([]Probability, len(seasons))
	for i, season := range seasons {
		out[i] = Probability{Season: season, P: exps[i] / total}
	}
	slices.SortStableFunc(out, func(a, b Probability) int {
		if c := cmp.Compare(b.P, a.P); c != 0 {
			return c
		}
		return cmp.Compare(a.Season, b.Season)
	})
	return out
}

// ConfidenceCap is the most a profile may claim: lower when the undertone
// or the contrast is missing.
func ConfidenceCap(undertoneKnown, contrastKnown bool) float64 {
	limit := confidenceMax
	if !undertoneKnown {
		limit = math.Min(limit, withoutUndertoneCap)
	}
	if !contrastKnown {
		limit = math.Min(limit, withoutContrastCap)
	}
	return limit
}

// Decision is the season (nil when the evidence is too weak) and the
// runner-up.
type Decision struct {
	Season              *string  `json:"season"`
	Confidence          float64  `json:"confidence"`
	SecondarySeason     *string  `json:"secondarySeason"`
	SecondaryConfidence *float64 `json:"secondaryConfidence"`
}

// DecideSeason decides from the probabilities (the most likely first).
func DecideSeason(probabilities []Probability, evidence, limit float64) Decision {
	d := Decision{Confidence: round2(math.Min(limit, probabilities[0].P*evidence))}
	if d.Confidence < seasonMin {
		return d
	}
	first, second := probabilities[0].Season, probabilities[1].Season
	secondary := round2(math.Min(limit, probabilities[1].P*evidence))
	d.Season, d.SecondarySeason, d.SecondaryConfidence = &first, &second, &secondary
	return d
}

// Palette is a season's colours.
type Palette struct {
	Recommended []string `json:"recommended"`
	Neutral     []string `json:"neutral"`
	Caution     []string `json:"caution"`
}

// Palettes are the seasons' colours.
var Palettes = map[string]Palette{
	"spring": {
		Recommended: []string{"cream", "light_blue", "khaki", "mustard", "tan", "beige", "olive", "orange"},
		Neutral:     []string{"cream", "beige", "tan", "ivory"},
		Caution:     []string{"black", "navy", "burgundy", "purple"},
	},
	"summer": {
		Recommended: []string{"white", "light_blue", "pink", "gray", "navy", "cream", "ivory", "blue"},
		Neutral:     []string{"gray", "cream", "ivory", "white"},
		Caution:     []string{"orange", "mustard", "rust", "olive"},
	},
	"autumn": {
		Recommended: []string{"beige", "brown", "olive", "mustard", "rust", "burgundy", "tan", "khaki"},
		Neutral:     []string{"beige", "tan", "brown", "cream"},
		Caution:     []string{"white", "light_blue", "pink", "gray"},
	},
	"winter": {
		Recommended: []string{"white", "black", "navy", "burgundy", "red", "teal", "gray", "blue"},
		Neutral:     []string{"black", "gray", "navy", "white"},
		Caution:     []string{"beige", "cream", "tan", "mustard"},
	},
}

func inCatalog(ids []string) []string {
	out := []string{}
	for _, id := range ids {
		if slices.Contains(catalog.Colors, id) {
			out = append(out, id)
		}
	}
	return out
}

// ─── The analysis ───────────────────────────────────────────────────────────

// Analysis is what is stored for audit and calibration: no colour values,
// no image data.
type Analysis struct {
	Version     string  `json:"version"`
	Quality     float64 `json:"quality"`
	SkinPixels  int     `json:"skinPixels"`
	SkinRegions int     `json:"skinRegions"`
	Agreement   float64 `json:"agreement"`
	HairKnown   bool    `json:"hairKnown"`
	EyesKnown   bool    `json:"eyesKnown"`
}

// Result is a colour profile.
type Result struct {
	Version             string   `json:"version"`
	SkinTone            string   `json:"skinTone"`
	Undertone           string   `json:"undertone"` // or "unknown"
	UndertoneConfidence float64  `json:"undertoneConfidence"`
	HairColor           *string  `json:"hairColor"`
	EyeColor            *string  `json:"eyeColor"`
	ContrastLevel       *string  `json:"contrastLevel"`
	Season              *string  `json:"season"` // nil when the evidence supports none
	Confidence          float64  `json:"confidence"`
	SecondarySeason     *string  `json:"secondarySeason"`
	SecondaryConfidence *float64 `json:"secondaryConfidence"`
	RecommendedColors   []string `json:"recommendedColors"`
	NeutralColors       []string `json:"neutralColors"`
	CautionColors       []string `json:"cautionColors"`
	Analysis            Analysis `json:"analysis"`
}

// AnalyzeCanvas analyses a canvas; *PhotoQualityError or
// ErrSkinNotVisible when the photo cannot be analysed.
func AnalyzeCanvas(c Canvas) (Result, error) {
	quality, err := AssessQuality(MeasureQuality(c))
	if err != nil {
		return Result{}, err
	}
	skin, err := MeasureSkin(c)
	if err != nil {
		return Result{}, err
	}
	sampleFactor := clamp(float64(skin.Pixels)/2500, 0.4, 1)

	hue := HueAngle(skin.Lab)
	marginFactor := clamp(UndertoneMargin(hue)/3, 0, 1)
	undertoneConfidence := round2(math.Min(undertoneMax, (0.35+float64(0.65*marginFactor))*skin.Agreement*quality*sampleFactor))
	undertone := "unknown"
	if undertoneConfidence >= undertoneMin {
		undertone = ClassifyUndertone(hue)
	}

	hair := MeasureHair(c, skin)
	eyes := MeasureEyes(c, skin)
	contrast := ContrastOf(skin.Lab, hair.Lab, eyes.Lab)
	var contrastValue *float64
	if contrast != nil {
		contrastValue = &contrast.Value
	}

	probabilities := SeasonProbabilities(SeasonFeaturesOf(skin.Lab, undertone != "unknown", hair.Lab, contrastValue))
	evidence := quality * sampleFactor * (0.5 + float64(0.5*skin.Agreement))
	decision := DecideSeason(probabilities, evidence, ConfidenceCap(undertone != "unknown", contrast != nil))

	r := Result{
		Version: Version, SkinTone: ClassifySkinTone(skin.Lab.L), Undertone: undertone, UndertoneConfidence: undertoneConfidence,
		HairColor: hair.Color, EyeColor: eyes.Color,
		Season: decision.Season, Confidence: decision.Confidence, SecondarySeason: decision.SecondarySeason, SecondaryConfidence: decision.SecondaryConfidence,
		RecommendedColors: []string{}, NeutralColors: []string{}, CautionColors: []string{},
		Analysis: Analysis{
			Version: Version, Quality: round2(quality), SkinPixels: skin.Pixels, SkinRegions: skin.Cells, Agreement: round2(skin.Agreement),
			HairKnown: hair.Color != nil, EyesKnown: eyes.Color != nil,
		},
	}
	if contrast != nil {
		r.ContrastLevel = &contrast.Level
	}
	if decision.Season != nil {
		p := Palettes[*decision.Season]
		r.RecommendedColors, r.NeutralColors, r.CautionColors = inCatalog(p.Recommended), inCatalog(p.Neutral), inCatalog(p.Caution)
	}
	return r, nil
}
