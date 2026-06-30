package agent

import (
	"context"
	"fmt"
	"io"
	"time"

	pb "github.com/ajjs1ajjs/BCK/proto/agent"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type Client struct {
	conn   *grpc.ClientConn
	client pb.AgentClient
	logger *zap.Logger
	addr   string
}

func NewClient(addr string, logger *zap.Logger) (*Client, error) {
	conn, err := grpc.NewClient(addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(64*1024*1024)),
		grpc.WithDefaultCallOptions(grpc.MaxCallSendMsgSize(64*1024*1024)),
	)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}

	return &Client{
		conn:   conn,
		client: pb.NewAgentClient(conn),
		logger: logger,
		addr:   addr,
	}, nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

func (c *Client) Ping(ctx context.Context) (*pb.PingResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	return c.client.Ping(ctx, &pb.PingRequest{})
}

func (c *Client) Scan(ctx context.Context, path string, excludePatterns []string) ([]*pb.FileEntry, error) {
	stream, err := c.client.Scan(ctx, &pb.ScanRequest{
		Path:            path,
		ExcludePatterns: excludePatterns,
	})
	if err != nil {
		return nil, fmt.Errorf("start scan: %w", err)
	}

	var files []*pb.FileEntry
	for {
		entry, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("recv scan: %w", err)
		}
		files = append(files, entry)
	}

	return files, nil
}

func (c *Client) BackupFile(ctx context.Context, filePath string, data []byte, mode uint32, modTime int64) (*pb.BackupSummary, error) {
	stream, err := c.client.Backup(ctx)
	if err != nil {
		return nil, fmt.Errorf("start backup stream: %w", err)
	}

	chunkSize := 4 * 1024 * 1024 // 4MB
	for i := 0; i < len(data); i += chunkSize {
		end := i + chunkSize
		if end > len(data) {
			end = len(data)
		}
		isLast := end >= len(data)

		err := stream.Send(&pb.BackupChunk{
			FilePath:    filePath,
			Data:        data[i:end],
			Offset:      int64(i),
			IsLast:      isLast,
			Mode:        mode,
			ModTimeUnix: modTime,
		})
		if err != nil {
			return nil, fmt.Errorf("send chunk: %w", err)
		}
	}

	return stream.CloseAndRecv()
}

func (c *Client) Restore(ctx context.Context, snapshotID, targetPath string, files []string, progressCh chan<- *pb.RestoreProgress) error {
	stream, err := c.client.Restore(ctx, &pb.RestoreRequest{
		SnapshotId: snapshotID,
		TargetPath: targetPath,
		Files:      files,
	})
	if err != nil {
		return fmt.Errorf("start restore: %w", err)
	}

	for {
		progress, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("recv restore progress: %w", err)
		}
		if progressCh != nil {
			progressCh <- progress
		}
		if progress.Complete {
			break
		}
	}

	return nil
}

func (c *Client) Exec(ctx context.Context, command string, timeoutSeconds int32) (*pb.ExecResponse, error) {
	return c.client.Exec(ctx, &pb.ExecRequest{
		Command:        command,
		TimeoutSeconds: timeoutSeconds,
	})
}
