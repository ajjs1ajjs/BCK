package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go.uber.org/zap"
)

type MLModelType string

const (
	MLPyTorch       MLModelType = "pytorch"
	MLTensorFlow    MLModelType = "tensorflow"
	MLONNX          MLModelType = "onnx"
	MLHuggingFace   MLModelType = "huggingface"
	MLCheckpoint    MLModelType = "checkpoint"
	MLSafetensors   MLModelType = "safetensors"
	MLGGUF          MLModelType = "gguf"
	MLVectorIndex   MLModelType = "vector_index"
)

type MLModelInfo struct {
	Name           string            `json:"name"`
	Type           MLModelType       `json:"type"`
	Format         string            `json:"format"`
	Version        string            `json:"version"`
	Size           int64             `json:"size_bytes"`
	Architecture   string            `json:"architecture"`
	Params         int64             `json:"parameters_count"`
	Precision      string            `json:"precision"` // fp32, fp16, bf16, int8, int4
	Tags           []string          `json:"tags"`
	TrainingDataHash string          `json:"training_data_hash,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

type MLBackupEngine struct {
	logger    *zap.Logger
	chunker   *CDCChunker
	compressor *Compressor
}

func NewMLBackupEngine(logger *zap.Logger) *MLBackupEngine {
	return &MLBackupEngine{
		logger:     logger,
		chunker:    NewCDCChunker(16 * 1024 * 1024), // Larger chunks for model files
		compressor: NewCompressor(1),                 // Fast compression for large files
	}
}

func (ml *MLBackupEngine) DetectModel(path string) (*MLModelInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	modelInfo := &MLModelInfo{
		Name:    filepath.Base(path),
		Size:    info.Size(),
		Version: time.Now().Format("20060102"),
	}

	ext := strings.ToLower(filepath.Ext(path))

	switch {
	case ext == ".pt" || ext == ".pth":
		modelInfo.Type = MLPyTorch
		modelInfo.Format = "pytorch"
	case ext == ".safetensors":
		modelInfo.Type = MLSafetensors
		modelInfo.Format = "safetensors"
	case ext == ".onnx":
		modelInfo.Type = MLONNX
		modelInfo.Format = "onnx"
	case ext == ".gguf":
		modelInfo.Type = MLGGUF
		modelInfo.Format = "gguf"
	case ext == ".h5" || strings.Contains(path, "saved_model"):
		modelInfo.Type = MLTensorFlow
		modelInfo.Format = "tensorflow"
	case ext == ".ckpt" || ext == ".pt":
		modelInfo.Type = MLCheckpoint
		modelInfo.Format = "checkpoint"
	case ext == ".bin" && strings.Contains(path, "pytorch_model"):
		modelInfo.Type = MLPyTorch
		modelInfo.Format = "huggingface"
	case ext == ".index":
		modelInfo.Type = MLVectorIndex
		modelInfo.Format = "faiss"
	}

	return modelInfo, nil
}

func (ml *MLBackupEngine) BackupModel(ctx context.Context, sourcePath, repoPath string, progressCh chan<- BackupProgress) (*Snapshot, error) {
	modelInfo, err := ml.DetectModel(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("detect model: %w", err)
	}

	ml.logger.Info("backing up ML model",
		zap.String("name", modelInfo.Name),
		zap.String("type", string(modelInfo.Type)),
		zap.Int64("size", modelInfo.Size),
	)

	snapshot := &Snapshot{
		ID:        fmt.Sprintf("ml-%s-%s", modelInfo.Name, TimestampFilename()),
		StartTime: time.Now(),
		Chunks:    make(map[string]*ChunkInfo),
		Tags:      []string{"ml-model", string(modelInfo.Type)},
	}

	chunkDir := filepath.Join(repoPath, "chunks")
	snapshotDir := filepath.Join(repoPath, "snapshots")
	os.MkdirAll(chunkDir, 0700)
	os.MkdirAll(snapshotDir, 0700)

	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("read model: %w", err)
	}

	chunks := ml.chunker.ChunkData(data)
	dedup := NewDedupStore()

	for _, chunk := range chunks {
		chunkID := chunk.ID()
		if !dedup.IsUnique(chunkID) {
			continue
		}

		compressed, _ := ml.compressor.Compress(chunk)

		chunkPath := filepath.Join(chunkDir, chunkID[:2], chunkID)
		os.MkdirAll(filepath.Dir(chunkPath), 0700)
		os.WriteFile(chunkPath, compressed, 0600)

		chunkInfo := &ChunkInfo{
			ID:   chunkID,
			Size: int64(len(compressed)),
			Hash: chunkID,
		}
		snapshot.Chunks[chunkID] = chunkInfo
	}

	// Save model metadata alongside snapshot
	metadataPath := filepath.Join(snapshotDir, snapshot.ID+"_metadata.json")
	metaJSON, _ := json.MarshalIndent(modelInfo, "", "  ")
	os.WriteFile(metadataPath, metaJSON, 0600)

	snapshot.TotalSize = modelInfo.Size
	snapshot.EndTime = time.Now()

	progressCh <- BackupProgress{
		Phase:         "completed",
		BytesProcessed: modelInfo.Size,
	}

	ml.logger.Info("ML model backup completed",
		zap.String("model", modelInfo.Name),
		zap.Int64("chunks", snapshot.ChunkCount),
	)

	return snapshot, nil
}

func (ml *MLBackupEngine) BackupHuggingFace(ctx context.Context, modelID, repoPath string, progressCh chan<- BackupProgress) (*Snapshot, error) {
	ml.logger.Info("backing up HuggingFace model", zap.String("model", modelID))

	// HuggingFace models typically consist of:
	// - config.json
	// - pytorch_model.bin / model.safetensors
	// - tokenizer.json, tokenizer_config.json
	// - vocab files

	cacheDir := filepath.Join(os.Getenv("HF_HOME"), "hub", "models--"+strings.ReplaceAll(modelID, "/", "--"))

	if _, err := os.Stat(cacheDir); os.IsNotExist(err) {
		cacheDir = filepath.Join(os.Getenv("HOME"), ".cache", "huggingface", "hub",
			"models--"+strings.ReplaceAll(modelID, "/", "--"))
	}

	snapshot := &Snapshot{
		ID:        fmt.Sprintf("hf-%s-%s", strings.ReplaceAll(modelID, "/", "_"), TimestampFilename()),
		StartTime: time.Now(),
		Chunks:    make(map[string]*ChunkInfo),
		Tags:      []string{"ml-model", "huggingface", modelID},
	}

	dedup := NewDedupStore()
	chunkDir := filepath.Join(repoPath, "chunks")

	filepath.Walk(cacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasPrefix(info.Name(), "model.") && !strings.HasPrefix(info.Name(), "config.") && !strings.HasPrefix(info.Name(), "tokenizer.") {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		chunks := ml.chunker.ChunkData(data)
		for _, chunk := range chunks {
			chunkID := chunk.ID()
			if !dedup.IsUnique(chunkID) {
				continue
			}
			compressed, _ := ml.compressor.Compress(chunk)
			chunkPath := filepath.Join(chunkDir, chunkID[:2], chunkID)
			os.MkdirAll(filepath.Dir(chunkPath), 0700)
			os.WriteFile(chunkPath, compressed, 0600)
			snapshot.Chunks[chunkID] = &ChunkInfo{ID: chunkID, Size: int64(len(compressed)), Hash: chunkID}
		}

		return nil
	})

	snapshot.EndTime = time.Now()
	return snapshot, nil
}

func (ml *MLBackupEngine) RestoreCheckpoint(ctx context.Context, snapshotID, targetDir string) error {
	ml.logger.Info("restoring ML checkpoint", zap.String("snapshot", snapshotID), zap.String("target", targetDir))
	os.MkdirAll(targetDir, 0700)
	return nil
}
