package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/ajjs1ajjs/BCK/internal/backup"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type S3Config struct {
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	Bucket          string `json:"bucket"`
	Prefix          string `json:"prefix"`
	AccessKeyID     string `json:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key"`
	UsePathStyle    bool   `json:"use_path_style"`
}

type S3Repo struct {
	client *s3.Client
	cfg    S3Config
}

func NewS3Repo(cfg S3Config) (*S3Repo, error) {
	awsCfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(cfg.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID, cfg.SecretAccessKey, "",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = cfg.UsePathStyle
		if cfg.Endpoint != "" {
			o.EndpointResolver = s3.EndpointResolverFromURL(cfg.Endpoint)
		}
	})

	return &S3Repo{
		client: client,
		cfg:    cfg,
	}, nil
}

func (r *S3Repo) Init() error {
	return nil
}

func (r *S3Repo) key(path string) string {
	if r.cfg.Prefix != "" {
		return r.cfg.Prefix + "/" + path
	}
	return path
}

func (r *S3Repo) StoreChunk(id string, data []byte) error {
	key := r.key("chunks/" + id[:2] + "/" + id)
	_, err := r.client.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket: aws.String(r.cfg.Bucket),
		Key:    aws.String(key),
		Body:   bytes.NewReader(data),
	})
	return err
}

func (r *S3Repo) LoadChunk(id string) ([]byte, error) {
	key := r.key("chunks/" + id[:2] + "/" + id)
	resp, err := r.client.GetObject(context.Background(), &s3.GetObjectInput{
		Bucket: aws.String(r.cfg.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("get chunk: %w", err)
	}
	defer resp.Body.Close()

	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read chunk body: %w", err)
	}
	return buf.Bytes(), nil
}

func (r *S3Repo) DeleteChunk(id string) error {
	key := r.key("chunks/" + id[:2] + "/" + id)
	_, err := r.client.DeleteObject(context.Background(), &s3.DeleteObjectInput{
		Bucket: aws.String(r.cfg.Bucket),
		Key:    aws.String(key),
	})
	return err
}

func (r *S3Repo) ListChunks() ([]string, error) {
	var chunks []string
	paginator := s3.NewListObjectsV2Paginator(r.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(r.cfg.Bucket),
		Prefix: aws.String(r.key("chunks/")),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(context.Background())
		if err != nil {
			return nil, fmt.Errorf("list chunks: %w", err)
		}
		for _, obj := range page.Contents {
			chunks = append(chunks, filepath.Base(*obj.Key))
		}
	}

	return chunks, nil
}

func (r *S3Repo) StoreSnapshot(snap *backup.Snapshot) error {
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal snapshot: %w", err)
	}

	key := r.key("snapshots/" + snap.ID + ".json")
	_, err = r.client.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket: aws.String(r.cfg.Bucket),
		Key:    aws.String(key),
		Body:   bytes.NewReader(data),
	})
	return err
}

func (r *S3Repo) LoadSnapshot(id string) (*backup.Snapshot, error) {
	key := r.key("snapshots/" + id + ".json")
	resp, err := r.client.GetObject(context.Background(), &s3.GetObjectInput{
		Bucket: aws.String(r.cfg.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("get snapshot: %w", err)
	}
	defer resp.Body.Close()

	var snap backup.Snapshot
	if err := json.NewDecoder(resp.Body).Decode(&snap); err != nil {
		return nil, fmt.Errorf("decode snapshot: %w", err)
	}
	return &snap, nil
}

func (r *S3Repo) ListSnapshots() ([]string, error) {
	var snapshots []string
	paginator := s3.NewListObjectsV2Paginator(r.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(r.cfg.Bucket),
		Prefix: aws.String(r.key("snapshots/")),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(context.Background())
		if err != nil {
			return nil, fmt.Errorf("list snapshots: %w", err)
		}
		for _, obj := range page.Contents {
			name := filepath.Base(*obj.Key)
			snapshots = append(snapshots, strings.TrimSuffix(name, ".json"))
		}
	}

	return snapshots, nil
}

func (r *S3Repo) DeleteSnapshot(id string) error {
	key := r.key("snapshots/" + id + ".json")
	_, err := r.client.DeleteObject(context.Background(), &s3.DeleteObjectInput{
		Bucket: aws.String(r.cfg.Bucket),
		Key:    aws.String(key),
	})
	return err
}

func (r *S3Repo) Stats() (*RepoStats, error) {
	stats := &RepoStats{}

	snapshots, err := r.ListSnapshots()
	if err != nil {
		return stats, err
	}
	stats.TotalSnapshots = int64(len(snapshots))

	chunks, err := r.ListChunks()
	if err != nil {
		return stats, err
	}
	stats.TotalChunks = int64(len(chunks))

	return stats, nil
}

func (r *S3Repo) EnsureBucketExists(ctx context.Context) error {
	_, err := r.client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(r.cfg.Bucket),
	})
	if err != nil {
		_, createErr := r.client.CreateBucket(ctx, &s3.CreateBucketInput{
			Bucket: aws.String(r.cfg.Bucket),
			CreateBucketConfiguration: &types.CreateBucketConfiguration{
				LocationConstraint: types.BucketLocationConstraint(r.cfg.Region),
			},
		})
		if createErr != nil {
			return fmt.Errorf("create bucket: %w", createErr)
		}
	}
	return nil
}
