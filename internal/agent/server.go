package agent

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"

	pb "github.com/ajjs1ajjs/BCK/proto/agent"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

type Server struct {
	pb.UnimplementedAgentServer
	hostname string
	version  string
	started  time.Time
	logger   *zap.Logger
}

func NewServer(logger *zap.Logger) *Server {
	hostname, _ := os.Hostname()
	return &Server{
		hostname: hostname,
		version:  "0.2.0",
		started:  time.Now(),
		logger:   logger,
	}
}

func (s *Server) Ping(ctx context.Context, req *pb.PingRequest) (*pb.PingResponse, error) {
	return &pb.PingResponse{
		Version:       s.version,
		Hostname:      s.hostname,
		UptimeSeconds: int64(time.Since(s.started).Seconds()),
	}, nil
}

func (s *Server) Scan(req *pb.ScanRequest, stream pb.Agent_ScanServer) error {
	s.logger.Info("scan requested", zap.String("path", req.Path))

	exclude := make(map[string]bool)
	for _, p := range req.ExcludePatterns {
		exclude[p] = true
	}

	err := filepath.WalkDir(req.Path, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			stream.Send(&pb.FileEntry{
				Path:  path,
				Error: err.Error(),
			})
			return nil
		}

		relPath, _ := filepath.Rel(req.Path, path)
		name := filepath.Base(path)
		if exclude[name] || exclude[relPath] {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		info, _ := d.Info()
		if info == nil {
			return nil
		}

		entry := &pb.FileEntry{
			Path:        filepath.ToSlash(relPath),
			Size:        info.Size(),
			Mode:        uint32(info.Mode()),
			IsDir:       info.IsDir(),
			ModTimeUnix: info.ModTime().Unix(),
		}

		if info.Mode()&os.ModeSymlink != 0 {
			entry.IsSymlink = true
			if dest, err := os.Readlink(path); err == nil {
				entry.SymlinkDest = dest
			}
		}

		return stream.Send(entry)
	})

	return err
}

func (s *Server) Backup(stream pb.Agent_BackupServer) error {
	var bytesProcessed int64
	var filesProcessed int64

	for {
		chunk, err := stream.Recv()
		if err != nil {
			break
		}

		bytesProcessed += int64(len(chunk.Data))
		if chunk.IsLast {
			filesProcessed++
		}
	}

	return stream.SendAndClose(&pb.BackupSummary{
		SnapshotId:     fmt.Sprintf("agent-%d", time.Now().Unix()),
		BytesProcessed: bytesProcessed,
		FilesProcessed: filesProcessed,
		Success:        true,
	})
}

func (s *Server) Restore(req *pb.RestoreRequest, stream pb.Agent_RestoreServer) error {
	targetPath := req.TargetPath
	if err := os.MkdirAll(filepath.Dir(targetPath), 0700); err != nil {
		return fmt.Errorf("create dir: %w", err)
	}

	stream.Send(&pb.RestoreProgress{
		Complete: true,
	})

	return nil
}

func (s *Server) Exec(ctx context.Context, req *pb.ExecRequest) (*pb.ExecResponse, error) {
	return &pb.ExecResponse{
		Error: "exec not implemented on this platform",
	}, nil
}

func (s *Server) Serve(addr string) error {
	lis, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}

	grpcServer := grpc.NewServer()
	pb.RegisterAgentServer(grpcServer, s)

	s.logger.Info("agent gRPC server started", zap.String("addr", addr))
	return grpcServer.Serve(lis)
}
