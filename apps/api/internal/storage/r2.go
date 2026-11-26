package storage

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// R2Config names a bucket of Cloudflare R2 (or of another S3-compatible
// service) and the credentials for it.
type R2Config struct {
	// Endpoint is the service's origin, such as
	// https://<account id>.r2.cloudflarestorage.com.
	Endpoint string
	Bucket   string
	// Region is "auto" for R2.
	Region          string
	AccessKeyID     string
	SecretAccessKey string // secret
	// Client replaces the HTTP client (tests).
	Client *http.Client
	// Now replaces the clock requests are signed by (tests).
	Now func() time.Time
}

// R2 keeps images in a bucket through the S3 API (ADR 0010): one request
// per object, signed with Signature Version 4, addressed by path
// (endpoint/bucket/key). The keys are the local driver's.
type R2 struct {
	endpoint *url.URL
	bucket   string
	creds    credentials
	client   *http.Client
	now      func() time.Time
}

var _ Store = (*R2)(nil)

const (
	// maxObjectBytes bounds what Get reads: more than any image we store.
	maxObjectBytes = 64 << 20
	// maxErrorBytes bounds how much of an error answer is read.
	maxErrorBytes = 4 << 10
	// listPage is how many objects one listing request asks for.
	listPage = 1000
)

// NewR2 returns the driver. The settings are validated by the
// configuration; an endpoint that does not parse is refused here too.
func NewR2(c R2Config) (*R2, error) {
	endpoint, err := url.Parse(c.Endpoint)
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "https" && endpoint.Scheme != "http") {
		return nil, errors.New("storage: the R2 endpoint must be an http(s) origin")
	}
	if c.Bucket == "" || c.AccessKeyID == "" || c.SecretAccessKey == "" || c.Region == "" {
		return nil, errors.New("storage: the R2 bucket, region and credentials must be set")
	}
	r := &R2{
		endpoint: &url.URL{Scheme: endpoint.Scheme, Host: endpoint.Host},
		bucket:   c.Bucket,
		creds:    credentials{accessKeyID: c.AccessKeyID, secret: c.SecretAccessKey, region: c.Region},
		client:   c.Client,
		now:      c.Now,
	}
	if r.client == nil {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.ResponseHeaderTimeout = 30 * time.Second
		transport.MaxIdleConnsPerHost = 16
		// The service's answers are never followed elsewhere: a redirect
		// would carry the request, signed for this host, to another.
		r.client = &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	if r.now == nil {
		r.now = time.Now
	}
	return r, nil
}

// serviceError is an answer of the service that is not success.
type serviceError struct {
	Status int
	Code   string // the service's error code, such as NoSuchKey; "" when it gave none
}

func (e *serviceError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("status %d", e.Status)
	}
	return fmt.Sprintf("status %d (%s)", e.Status, e.Code)
}

// do sends one signed request for the bucket (key "") or an object and
// returns the body of a success. The body of a failure is read for its
// error code only: it can repeat parts of the request.
func (r *R2) do(ctx context.Context, method, key string, query url.Values, body []byte) ([]byte, error) {
	u := *r.endpoint
	u.Path = "/" + r.bucket
	if key != "" {
		u.Path += "/" + key
	}
	u.RawPath = canonicalPath(&u) // sent as it is signed
	u.RawQuery = canonicalQuery(query)
	req, err := http.NewRequestWithContext(ctx, method, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if method == http.MethodPut {
		req.Header.Set("Content-Type", ContentType(key))
	}
	r.creds.sign(req, hexSHA256(body), r.now())
	resp, err := r.client.Do(req)
	if err != nil {
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err // without the URL: the cause is enough, and the caller names the key
		}
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		var answer struct {
			Code string `xml:"Code"`
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBytes))
		_ = xml.Unmarshal(raw, &answer) // an answer without a code is reported by its status
		return nil, &serviceError{Status: resp.StatusCode, Code: answer.Code}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxObjectBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxObjectBytes {
		return nil, errors.New("the object is larger than any we store")
	}
	return data, nil
}

// absent: the service says the object is not there. A bucket that is not
// there (NoSuchBucket) is a failure, not an absent object: a read must not
// answer "no such picture", a deletion must not count as done.
func absent(err error) bool {
	var e *serviceError
	return errors.As(err, &e) && e.Status == http.StatusNotFound && e.Code == "NoSuchKey"
}

// notFound: a read's "not there": the service's own word for it, or a 404
// without one (a read of nothing is the same either way).
func notFound(err error) bool {
	var e *serviceError
	return absent(err) || errors.As(err, &e) && e.Status == http.StatusNotFound && e.Code == ""
}

// Put writes the object whole: a reader gets the old object or the new
// one, never part of one (an S3 PUT is atomic).
func (r *R2) Put(ctx context.Context, key string, data []byte) error {
	if !ValidKey(key) {
		return errors.New("storage: invalid key")
	}
	if _, err := r.do(ctx, http.MethodPut, key, nil, data); err != nil {
		return fmt.Errorf("storage: write %s: %w", key, err)
	}
	return nil
}

// Get reads an object.
func (r *R2) Get(ctx context.Context, key string) ([]byte, error) {
	if !ValidKey(key) {
		return nil, ErrNotFound
	}
	data, err := r.do(ctx, http.MethodGet, key, nil, nil)
	if notFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("storage: read %s: %w", key, err)
	}
	return data, nil
}

// Delete removes objects; missing ones and keys we never make are skipped.
func (r *R2) Delete(ctx context.Context, keys ...string) error {
	var errs []error
	for _, key := range keys {
		if !ValidKey(key) {
			continue
		}
		if err := r.remove(ctx, key); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (r *R2) remove(ctx context.Context, key string) error {
	// The service answers 204 for an object that was not there; a 404 that
	// does not name the object as missing is not a deletion done.
	if _, err := r.do(ctx, http.MethodDelete, key, nil, nil); err != nil && !absent(err) {
		return fmt.Errorf("storage: delete %s: %w", key, err)
	}
	return nil
}

// DeleteOwner removes every object under users/<owner>/, whatever its
// name. An owner with nothing stored is not an error.
func (r *R2) DeleteOwner(ctx context.Context, owner string) error {
	if !ownerID.MatchString(owner) {
		return errors.New("storage: invalid owner id")
	}
	var errs []error
	err := r.list(ctx, "users/"+owner+"/", func(o Object) error {
		if err := r.remove(ctx, o.Key); err != nil {
			errs = append(errs, err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("storage: remove the images of owner %s: %w", owner, err)
	}
	if len(errs) > 0 {
		return fmt.Errorf("storage: remove the images of owner %s: %w", owner, errors.Join(errs...))
	}
	return nil
}

// List calls fn for every object under users/.
func (r *R2) List(ctx context.Context, fn func(Object) error) error {
	if err := r.list(ctx, "users/", fn); err != nil {
		var stop stopListing
		if errors.As(err, &stop) {
			return stop.err
		}
		return fmt.Errorf("storage: list: %w", err)
	}
	return nil
}

// stopListing carries fn's own error out of list unchanged.
type stopListing struct{ err error }

func (s stopListing) Error() string { return s.err.Error() }

// list pages through the objects under the prefix (ListObjectsV2). The page
// is read whole before fn sees it, so fn may delete what it is given.
func (r *R2) list(ctx context.Context, prefix string, fn func(Object) error) error {
	token := ""
	for {
		query := url.Values{"list-type": {"2"}, "prefix": {prefix}, "max-keys": {fmt.Sprint(listPage)}}
		if token != "" {
			query.Set("continuation-token", token)
		}
		raw, err := r.do(ctx, http.MethodGet, "", query, nil)
		if err != nil {
			return err
		}
		var page struct {
			IsTruncated           bool   `xml:"IsTruncated"`
			NextContinuationToken string `xml:"NextContinuationToken"`
			Contents              []struct {
				Key          string    `xml:"Key"`
				LastModified time.Time `xml:"LastModified"`
			} `xml:"Contents"`
		}
		if err := xml.Unmarshal(raw, &page); err != nil {
			return fmt.Errorf("the listing is not the XML it should be: %w", err)
		}
		for _, o := range page.Contents {
			if err := fn(Object{Key: o.Key, ModifiedAt: o.LastModified}); err != nil {
				return stopListing{err}
			}
		}
		if !page.IsTruncated {
			return nil
		}
		if page.NextContinuationToken == "" || page.NextContinuationToken == token {
			return errors.New("the listing says there is more and gives no way to it")
		}
		token = page.NextContinuationToken
	}
}

// Check asks the service for one object's worth of listing: whether the
// bucket is there and the credentials are accepted. A refusal of the
// request itself (the bucket, the key, the signature) is reported as
// permanent; anything else may pass.
func (r *R2) Check(ctx context.Context) (permanent bool, err error) {
	_, err = r.do(ctx, http.MethodGet, "", url.Values{"list-type": {"2"}, "prefix": {"users/"}, "max-keys": {"1"}}, nil)
	var e *serviceError
	if errors.As(err, &e) && e.Status/100 == 4 && e.Status != http.StatusTooManyRequests && e.Status != http.StatusRequestTimeout {
		return true, fmt.Errorf("storage: the bucket refused the request: %w", err)
	}
	if err != nil {
		return false, fmt.Errorf("storage: the bucket could not be reached: %w", err)
	}
	return false, nil
}
