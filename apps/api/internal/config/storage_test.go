package config_test

import (
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"lookly/internal/config"
)

const r2Secret = "r2-secret-access-key-value-0123456789abcdef"

// r2 is a valid configuration that keeps the images in a bucket.
func r2(changes map[string]string) map[string]string {
	vars := with(map[string]string{
		"STORAGE_DRIVER": "r2", "STORAGE_LOCAL_DIR": "<unset>",
		"R2_ENDPOINT": "https://0123456789abcdef.r2.cloudflarestorage.com", "R2_BUCKET": "lookly-images",
		"R2_ACCESS_KEY_ID": "r2-test-access-key-id", "R2_SECRET_ACCESS_KEY": r2Secret,
	})
	for k, v := range changes {
		if v == "<unset>" {
			delete(vars, k)
		} else {
			vars[k] = v
		}
	}
	return vars
}

func TestStorageDrivers(t *testing.T) {
	t.Parallel()
	// The local driver is the default, and may be named.
	for _, driver := range []string{"<unset>", "local", "LOCAL"} {
		c, err := config.Load(env(with(map[string]string{"STORAGE_DRIVER": driver})))
		if err != nil || c.StorageDriver != config.StorageLocal || c.StorageLocalDir == "" || c.R2 != (config.R2{}) {
			t.Errorf("STORAGE_DRIVER %s: driver %q, dir %q, err %v", driver, c.StorageDriver, c.StorageLocalDir, err)
		}
	}
	// Named local, the bucket's settings may already be there (unused).
	if c, err := config.Load(env(r2(map[string]string{"STORAGE_DRIVER": "local", "STORAGE_LOCAL_DIR": "/srv/uploads"}))); err != nil || c.StorageDriver != config.StorageLocal || c.R2 != (config.R2{}) {
		t.Errorf("local with the bucket's settings: %+v, %v", c, err)
	}

	c, err := config.Load(env(r2(nil)))
	if err != nil {
		t.Fatal(err)
	}
	want := config.R2{
		Endpoint: "https://0123456789abcdef.r2.cloudflarestorage.com", Bucket: "lookly-images", Region: "auto",
		AccessKeyID: "r2-test-access-key-id", SecretAccessKey: r2Secret,
	}
	if c.StorageDriver != config.StorageR2 || c.R2 != want || c.StorageLocalDir != "" {
		t.Errorf("r2: driver %q, local dir %q, bucket settings wrong: %v", c.StorageDriver, c.StorageLocalDir, c.R2 != want)
	}
	// The endpoint is an origin: a trailing slash and the case of the host
	// do not matter; the region may be named; the directory may stay set.
	c, err = config.Load(env(r2(map[string]string{
		"STORAGE_DRIVER": "R2", "R2_ENDPOINT": "https://ABC.r2.cloudflarestorage.com/", "R2_REGION": "weur", "STORAGE_LOCAL_DIR": "/srv/uploads",
	})))
	if err != nil || c.R2.Endpoint != "https://abc.r2.cloudflarestorage.com" || c.R2.Region != "weur" || c.StorageLocalDir != "/srv/uploads" {
		t.Errorf("r2 with a region: %q %q %q, %v", c.R2.Endpoint, c.R2.Region, c.StorageLocalDir, err)
	}
	// A test server on this machine may be plain http, outside the deployed environments.
	for _, endpoint := range []string{"http://localhost:9000", "http://127.0.0.1:9000", "http://[::1]:9000"} {
		c, err := config.Load(env(r2(map[string]string{"LOOKLY_ENV": "test", "R2_ENDPOINT": endpoint})))
		if err != nil || c.R2.Endpoint != endpoint {
			t.Errorf("%s in test: %q, %v", endpoint, c.R2.Endpoint, err)
		}
	}
}

func TestStorageRefusals(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		vars     map[string]string
		variable string
	}{
		{"an unknown driver", with(map[string]string{"STORAGE_DRIVER": "s3"}), "STORAGE_DRIVER"},
		{"the bucket's settings without a driver", r2(map[string]string{"STORAGE_DRIVER": "<unset>", "STORAGE_LOCAL_DIR": "/srv/uploads"}), "STORAGE_DRIVER"},
		{"one setting of the bucket without a driver", with(map[string]string{"R2_BUCKET": "lookly-images"}), "STORAGE_DRIVER"},
		{"local without its directory", with(map[string]string{"STORAGE_LOCAL_DIR": "<unset>"}), "STORAGE_LOCAL_DIR"},
		{"local with a relative directory", with(map[string]string{"STORAGE_LOCAL_DIR": "storage/uploads"}), "STORAGE_LOCAL_DIR"},
		{"r2 with a relative directory", r2(map[string]string{"STORAGE_LOCAL_DIR": "storage/uploads"}), "STORAGE_LOCAL_DIR"},
		{"no endpoint", r2(map[string]string{"R2_ENDPOINT": "<unset>"}), "R2_ENDPOINT"},
		{"an endpoint without a scheme", r2(map[string]string{"R2_ENDPOINT": "abc.r2.cloudflarestorage.com"}), "R2_ENDPOINT"},
		{"an endpoint with a path", r2(map[string]string{"R2_ENDPOINT": "https://abc.r2.cloudflarestorage.com/lookly-images"}), "R2_ENDPOINT"},
		{"an endpoint with a query", r2(map[string]string{"R2_ENDPOINT": "https://abc.r2.cloudflarestorage.com?x=1"}), "R2_ENDPOINT"},
		{"an endpoint with credentials", r2(map[string]string{"R2_ENDPOINT": "https://key:secret-in-the-url@abc.r2.cloudflarestorage.com"}), "R2_ENDPOINT"},
		{"an endpoint of another scheme", r2(map[string]string{"R2_ENDPOINT": "s3://lookly-images"}), "R2_ENDPOINT"},
		{"a plain http endpoint", r2(map[string]string{"LOOKLY_ENV": "test", "R2_ENDPOINT": "http://abc.r2.cloudflarestorage.com"}), "R2_ENDPOINT"},
		{"plain http on another machine of the network", r2(map[string]string{"LOOKLY_ENV": "test", "R2_ENDPOINT": "http://storage.local:9000"}), "R2_ENDPOINT"},
		{"plain http on this machine in production", r2(map[string]string{"R2_ENDPOINT": "http://localhost:9000"}), "R2_ENDPOINT"},
		{"plain http on this machine in staging", r2(map[string]string{"LOOKLY_ENV": "staging", "R2_ENDPOINT": "http://127.0.0.1:9000"}), "R2_ENDPOINT"},
		{"no bucket", r2(map[string]string{"R2_BUCKET": "<unset>"}), "R2_BUCKET"},
		{"a bucket in upper case", r2(map[string]string{"R2_BUCKET": "Lookly-Images"}), "R2_BUCKET"},
		{"a bucket with a path", r2(map[string]string{"R2_BUCKET": "lookly/images"}), "R2_BUCKET"},
		{"a bucket too short", r2(map[string]string{"R2_BUCKET": "ab"}), "R2_BUCKET"},
		{"a bucket with dots", r2(map[string]string{"R2_BUCKET": "lookly.images"}), "R2_BUCKET"},
		{"a region that is no name", r2(map[string]string{"R2_REGION": "eu west"}), "R2_REGION"},
		{"no access key id", r2(map[string]string{"R2_ACCESS_KEY_ID": "<unset>"}), "R2_ACCESS_KEY_ID"},
		{"an access key id with a space", r2(map[string]string{"R2_ACCESS_KEY_ID": "0123 4567"}), "R2_ACCESS_KEY_ID"},
		{"no secret", r2(map[string]string{"R2_SECRET_ACCESS_KEY": "<unset>"}), "R2_SECRET_ACCESS_KEY"},
		{"an empty secret", r2(map[string]string{"R2_SECRET_ACCESS_KEY": ""}), "R2_SECRET_ACCESS_KEY"},
		{"a secret with a trailing newline", r2(map[string]string{"R2_SECRET_ACCESS_KEY": r2Secret + "\n"}), "R2_SECRET_ACCESS_KEY"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := config.Load(env(tc.vars))
			if err == nil {
				t.Fatal("accepted")
			}
			msg := err.Error()
			if !strings.Contains(msg, tc.variable+":") {
				t.Errorf("the error does not name %s: %q", tc.variable, msg)
			}
			for _, secret := range []string{r2Secret, "secret-in-the-url", "r2-test-access-key-id"} {
				if strings.Contains(msg, secret) {
					t.Errorf("the error shows %q: %q", secret, msg)
				}
			}
		})
	}
}

func TestPrintingTheConfigNeverShowsTheBucketsCredentials(t *testing.T) {
	t.Parallel()
	c, err := config.Load(env(r2(nil)))
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	slog.New(slog.NewJSONHandler(&b, nil)).Info("config", "config", c, "r2", c.R2)
	for _, s := range []string{fmt.Sprint(c), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", c), fmt.Sprintf("%v %+v %#v", c.R2, c.R2, c.R2), b.String()} {
		for _, secret := range []string{r2Secret, "r2-test-access-key-id"} {
			if strings.Contains(s, secret) {
				t.Errorf("printed config shows %q: %s", secret, s)
			}
		}
	}
	if !strings.Contains(b.String(), `"storageDriver":"r2"`) || !strings.Contains(b.String(), `"r2Bucket":"lookly-images"`) || !strings.Contains(b.String(), `"r2Credentials":"[set]"`) {
		t.Errorf("the log value lacks the storage settings: %s", b.String())
	}
}
