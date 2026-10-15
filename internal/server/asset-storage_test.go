package server

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func TestS3MultipartUpload(t *testing.T) {
	for _, scenario := range []string{"success", "retry", "part-failure", "complete-failure", "cancel"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			data := bytes.Repeat([]byte("x"), 2*s3UploadPartSize+123)
			var sizes []int
			var assembled []byte
			attempts, completed, aborted := 0, false, false
			endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/images/prefix/asset" {
					t.Errorf("unexpected path: %s", r.URL.Path)
				}
				query := r.URL.Query()
				w.Header().Set("Content-Type", "application/xml")
				switch {
				case r.Method == http.MethodPost && query.Has("uploads"):
					if r.Header.Get("Content-Type") != "image/png" {
						t.Error("missing content type")
					}
					fmt.Fprint(w, `<InitiateMultipartUploadResult><UploadId>test-upload</UploadId></InitiateMultipartUploadResult>`)
				case r.Method == http.MethodPut && query.Get("uploadId") == "test-upload":
					attempts++
					if scenario == "part-failure" || (scenario == "retry" && attempts == 1) {
						status := http.StatusBadRequest
						if scenario == "retry" {
							status = http.StatusServiceUnavailable
						}
						w.WriteHeader(status)
						fmt.Fprint(w, `<Error><Code>SlowDown</Code><Message>part failed</Message></Error>`)
						return
					}
					body, err := io.ReadAll(r.Body)
					if err != nil {
						t.Error(err)
					}
					if query.Get("partNumber") != fmt.Sprint(len(sizes)+1) {
						t.Error("unexpected part order")
					}
					sizes = append(sizes, len(body))
					assembled = append(assembled, body...)
					w.Header().Set("ETag", fmt.Sprintf(`"part-%d"`, len(sizes)))
					if scenario == "cancel" {
						cancel()
					}
				case r.Method == http.MethodPost && query.Get("uploadId") == "test-upload":
					if scenario == "complete-failure" {
						w.WriteHeader(http.StatusBadRequest)
						fmt.Fprint(w, `<Error><Code>InvalidPart</Code><Message>completion failed</Message></Error>`)
						return
					}
					var body struct {
						Parts []struct {
							Number int    `xml:"PartNumber"`
							ETag   string `xml:"ETag"`
						} `xml:"Part"`
					}
					if err := xml.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					if len(body.Parts) != 3 {
						t.Errorf("completed parts: %v", body.Parts)
					}
					for i, part := range body.Parts {
						if part.Number != i+1 || part.ETag != fmt.Sprintf(`"part-%d"`, i+1) {
							t.Errorf("invalid completed part: %+v", part)
						}
					}
					completed = true
					fmt.Fprint(w, `<CompleteMultipartUploadResult><ETag>final</ETag></CompleteMultipartUploadResult>`)
				case r.Method == http.MethodDelete && query.Get("uploadId") == "test-upload":
					aborted = true
					w.WriteHeader(http.StatusNoContent)
				default:
					t.Errorf("unexpected request: %s %s", r.Method, r.URL)
					w.WriteHeader(http.StatusBadRequest)
				}
			}))
			defer endpoint.Close()
			client := s3.NewFromConfig(aws.Config{Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", "")}, func(options *s3.Options) {
				options.BaseEndpoint = aws.String(endpoint.URL)
				options.UsePathStyle = true
			})
			store := s3AssetStorage{client: client, bucket: "images", prefix: "prefix"}
			err := store.Put(ctx, "asset", "image/png", data)
			success := scenario == "success" || scenario == "retry"
			if success {
				if err != nil {
					t.Fatal(err)
				}
				if !completed || aborted || !bytes.Equal(assembled, data) || !reflect.DeepEqual(sizes, []int{s3UploadPartSize, s3UploadPartSize, 123}) {
					t.Fatalf("incorrect multipart result: completed=%v aborted=%v sizes=%v", completed, aborted, sizes)
				}
				if scenario == "retry" && attempts != 4 {
					t.Errorf("part attempts: %d", attempts)
				}
			} else if err == nil || !aborted || completed {
				t.Fatalf("expected failure and cleanup: err=%v aborted=%v completed=%v", err, aborted, completed)
			}
		})
	}
}
