package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

// Storage drivers (STORAGE_DRIVER).
const (
	// StorageLocal keeps the images in a directory of this machine.
	StorageLocal = "local"
	// StorageR2 keeps them in a Cloudflare R2 bucket, through its S3 API.
	StorageR2 = "r2"
)

// R2 is the bucket the images are kept in when STORAGE_DRIVER is r2.
type R2 struct {
	// Endpoint is the account's S3 endpoint, an origin:
	// https://<account id>.r2.cloudflarestorage.com.
	Endpoint string
	Bucket   string
	// Region is "auto" for R2.
	Region          string
	AccessKeyID     string
	SecretAccessKey string // secret
}

// String keeps the credentials out of fmt output.
func (r R2) String() string {
	return fmt.Sprintf("R2{Endpoint:%s Bucket:%s Region:%s AccessKeyID:%s SecretAccessKey:%s}",
		r.Endpoint, r.Bucket, r.Region, setOrNot(r.AccessKeyID), setOrNot(r.SecretAccessKey))
}

// GoString keeps the credentials out of %#v.
func (r R2) GoString() string { return r.String() }

// LogValue keeps the credentials out of logs.
func (r R2) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("endpoint", r.Endpoint), slog.String("bucket", r.Bucket), slog.String("region", r.Region),
		slog.String("credentials", setOrNot(r.SecretAccessKey)),
	)
}

var (
	// bucketName is S3's rule for a bucket's name, without dots (a name
	// with dots cannot be served over TLS by path either way).
	bucketName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`)
	regionName = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)
)

// r2Variables are the settings of the R2 driver.
var r2Variables = []string{"R2_ENDPOINT", "R2_BUCKET", "R2_REGION", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"}

// loadStorage reads where the images are kept. The driver is never guessed
// from what else is set: settings of the bucket without STORAGE_DRIVER
// stop the server, so that images are not written to the local disk by a
// server meant to use the bucket.
func loadStorage(env Env, value, getenv func(string) (string, bool), fail func(string, string, ...any)) (driver, localDir string, r2 R2) {
	driver = StorageLocal
	chosen, _ := value("STORAGE_DRIVER")
	switch strings.ToLower(chosen) {
	case StorageLocal, StorageR2:
		driver = strings.ToLower(chosen)
	case "":
		for _, name := range r2Variables {
			if _, set := value(name); set {
				fail("STORAGE_DRIVER", "is not set although %s is: say local or r2", name)
				break
			}
		}
	default:
		fail("STORAGE_DRIVER", "must be local or r2")
	}

	if dir, ok := value("STORAGE_LOCAL_DIR"); ok {
		if !filepath.IsAbs(dir) {
			fail("STORAGE_LOCAL_DIR", "must be an absolute path")
		} else {
			localDir = filepath.Clean(dir)
		}
	} else if driver == StorageLocal {
		fail("STORAGE_LOCAL_DIR", "is not set (the directory the images are stored in)")
	}
	if driver != StorageR2 {
		return driver, localDir, R2{}
	}

	if v, ok := value("R2_ENDPOINT"); !ok {
		fail("R2_ENDPOINT", "is not set (https://<account id>.r2.cloudflarestorage.com)")
	} else if origin, err := parseR2Endpoint(v, env); err != nil {
		fail("R2_ENDPOINT", "%v", err)
	} else {
		r2.Endpoint = origin
	}
	if v, ok := value("R2_BUCKET"); !ok {
		fail("R2_BUCKET", "is not set")
	} else if !bucketName.MatchString(v) {
		fail("R2_BUCKET", "must be a bucket name: 3 to 63 lower-case letters, digits and hyphens")
	} else {
		r2.Bucket = v
	}
	r2.Region = "auto"
	if v, ok := value("R2_REGION"); ok {
		if !regionName.MatchString(v) {
			fail("R2_REGION", "must be a region name such as auto")
		} else {
			r2.Region = v
		}
	}
	if v, ok := value("R2_ACCESS_KEY_ID"); !ok {
		fail("R2_ACCESS_KEY_ID", "is not set")
	} else if strings.ContainsFunc(v, func(r rune) bool { return r > unicode.MaxASCII || unicode.IsSpace(r) || unicode.IsControl(r) }) {
		fail("R2_ACCESS_KEY_ID", "must be the access key id as issued, without white space")
	} else {
		r2.AccessKeyID = v
	}
	// The secret is used exactly as given: white space around it is a
	// mistake of an editor, and signs nothing the service accepts.
	switch secret, _ := getenv("R2_SECRET_ACCESS_KEY"); {
	case secret == "":
		fail("R2_SECRET_ACCESS_KEY", "is not set")
	case strings.TrimSpace(secret) != secret:
		fail("R2_SECRET_ACCESS_KEY", "must not start or end with white space")
	default:
		r2.SecretAccessKey = secret
	}
	return driver, localDir, r2
}

// parseR2Endpoint reads R2_ENDPOINT: an origin only. Requests are signed
// with the secret and carry the images, so the endpoint is https; plain
// http is for a test server on this machine, never where the server is
// deployed.
func parseR2Endpoint(value string, env Env) (string, error) {
	const originOnly = "must be an origin only (no path, query, fragment or credentials), such as https://<account id>.r2.cloudflarestorage.com"
	if strings.ContainsFunc(value, func(r rune) bool { return r > unicode.MaxASCII || unicode.IsSpace(r) || unicode.IsControl(r) }) {
		return "", errors.New(originOnly)
	}
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || u.Hostname() == "" {
		return "", errors.New("must be an absolute URL such as https://<account id>.r2.cloudflarestorage.com")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", errors.New("must use https")
	}
	if u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(value, "#") || (u.Path != "" && u.Path != "/") {
		return "", errors.New(originOnly)
	}
	if scheme == "http" {
		host := strings.ToLower(u.Hostname())
		local := host == "localhost" || host == "127.0.0.1" || host == "::1"
		if !local || env == Production || env == Staging {
			return "", errors.New("must use https (plain http is for a test server on this machine only)")
		}
	}
	return scheme + "://" + strings.ToLower(u.Host), nil
}
