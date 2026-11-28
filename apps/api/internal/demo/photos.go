package demo

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"

	"lookly/internal/imaging"
)

// Photos reads the photos a manifest names from the manifest's folder. A
// name never leads out of it: not by "..", not by a symbolic link (os.Root).
type Photos struct {
	root *os.Root
}

// OpenPhotos opens the folder the manifest's photo paths are relative to.
func OpenPhotos(dir string) (*Photos, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("the manifest's folder: %w", err)
	}
	return &Photos{root: root}, nil
}

// Close releases the folder.
func (p *Photos) Close() error { return p.root.Close() }

// Read returns a photo's bytes: a regular file of at most imaging.MaxBytes
// (an upload's limit), judged before it is read.
func (p *Photos) Read(file string) ([]byte, error) {
	f, err := p.root.Open(file)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, errors.New("not found")
	}
	if err != nil {
		return nil, fmt.Errorf("cannot be opened: %w", err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("cannot be read: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("not a regular file")
	}
	if info.Size() > imaging.MaxBytes {
		return nil, errors.New("larger than 8 MB")
	}
	data, err := io.ReadAll(io.LimitReader(f, imaging.MaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("cannot be read: %w", err)
	}
	if len(data) > imaging.MaxBytes { // it grew since it was judged
		return nil, errors.New("larger than 8 MB")
	}
	return data, nil
}

// Processor checks and converts a picture (*imaging.Processor, as for an
// upload).
type Processor interface {
	Process(ctx context.Context, data []byte) (imaging.Variants, error)
}

// Check reads every photo of the manifest and puts it through the image
// pipeline of an upload, keeping nothing: a photo that would be refused
// stops the run before anything is written. The error names the photo.
func Check(ctx context.Context, processor Processor, photos *Photos, m Manifest) error {
	for _, item := range m.Items {
		if _, _, err := process(ctx, processor, photos, item.File); err != nil {
			return fmt.Errorf("photo %s: %w", item.File, err)
		}
	}
	return nil
}

// process reads one photo and converts it.
func process(ctx context.Context, processor Processor, photos *Photos, file string) ([]byte, imaging.Variants, error) {
	data, err := photos.Read(file)
	if err != nil {
		return nil, imaging.Variants{}, err
	}
	variants, err := processor.Process(ctx, data)
	if err != nil {
		return nil, imaging.Variants{}, refusal(err)
	}
	return data, variants, nil
}

// refusal is the pipeline's refusal in an operator's words, the cause
// kept for errors.Is.
func refusal(err error) error {
	var reason string
	switch {
	case errors.Is(err, imaging.ErrUnsupported):
		reason = "not a JPEG, PNG or WebP picture"
	case errors.Is(err, imaging.ErrDimensions):
		reason = fmt.Sprintf("each side must be %d to %d pixels, and the picture at most %d pixels in all", imaging.MinSide, imaging.MaxSide, imaging.MaxPixels)
	case errors.Is(err, imaging.ErrInvalid):
		reason = "not a readable picture"
	default:
		return err
	}
	return fmt.Errorf("%s (%w)", reason, err)
}
