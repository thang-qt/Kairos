package server

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type assetStorage interface {
	Put(context.Context, string, string, []byte) error
	Get(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
}

type localAssetStorage struct{ directory string }

func (store localAssetStorage) filename(key string) (string, error) {
	if key == "" || filepath.Base(key) != key || key == "." || key == ".." || strings.ContainsAny(key, `/\`) {
		return "", fmt.Errorf("invalid asset key")
	}
	return filepath.Join(store.directory, key), nil
}

func (store localAssetStorage) Put(ctx context.Context, key, _ string, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	filename, err := store.filename(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(store.directory, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(store.directory, ".upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), filename)
}

func (store localAssetStorage) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	filename, err := store.filename(key)
	if err != nil {
		return nil, err
	}
	return os.Open(filename)
}

func (store localAssetStorage) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	filename, err := store.filename(key)
	if err != nil {
		return err
	}
	err = os.Remove(filename)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

type s3AssetStorage struct {
	client *s3.Client
	bucket string
	prefix string
}

func newS3AssetStorage(ctx context.Context, config Config) (*s3AssetStorage, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(config.S3Region))
	if err != nil {
		return nil, fmt.Errorf("load S3 configuration: %w", err)
	}
	client := s3.NewFromConfig(cfg, func(options *s3.Options) {
		if config.S3Endpoint != "" {
			options.BaseEndpoint = aws.String(config.S3Endpoint)
		}
		options.UsePathStyle = config.S3ForcePathStyle
	})
	return &s3AssetStorage{client: client, bucket: config.S3Bucket, prefix: strings.Trim(config.S3Prefix, "/")}, nil
}

func (store *s3AssetStorage) key(key string) string {
	if store.prefix == "" {
		return key
	}
	return store.prefix + "/" + key
}

func (store *s3AssetStorage) Put(ctx context.Context, key, mime string, data []byte) error {
	_, err := store.client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(store.bucket), Key: aws.String(store.key(key)), ContentType: aws.String(mime), Body: bytes.NewReader(data)})
	return err
}

func (store *s3AssetStorage) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	result, err := store.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(store.bucket), Key: aws.String(store.key(key))})
	if err != nil {
		return nil, err
	}
	return result.Body, nil
}

func (store *s3AssetStorage) Delete(ctx context.Context, key string) error {
	_, err := store.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(store.bucket), Key: aws.String(store.key(key))})
	return err
}
