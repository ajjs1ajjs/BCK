package backup

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go.uber.org/zap"
)

type ContentType string

const (
	ContentBinary    ContentType = "binary"
	ContentText      ContentType = "text"
	ContentImage     ContentType = "image"
	ContentSQL       ContentType = "sql"
	ContentJSON      ContentType = "json"
	ContentXML       ContentType = "xml"
	ContentCompressed ContentType = "compressed"
	ContentVM        ContentType = "vm_disk"
	ContentContainer ContentType = "container_layer"
	ContentTar       ContentType = "tar"
)

type DeltaBlock struct {
	Offset   int64  `json:"offset"`
	Size     int    `json:"size"`
	OldChecksum string `json:"old_checksum,omitempty"`
	NewChecksum string `json:"new_checksum"`
	Data     []byte `json:"data,omitempty"`
}

type ContentAwareBackup struct {
	logger     *zap.Logger
	chunker    *CDCChunker
	compressor *Compressor
}

func NewContentAwareBackup(logger *zap.Logger) *ContentAwareBackup {
	return &ContentAwareBackup{
		logger:     logger,
		chunker:    NewCDCChunker(4 * 1024 * 1024),
		compressor: NewCompressor(3),
	}
}

func (cab *ContentAwareBackup) DetectType(path string, data []byte) ContentType {
	ext := strings.ToLower(filepath.Ext(path))

	switch ext {
	case ".sql", ".psql":
		return ContentSQL
	case ".json":
		return ContentJSON
	case ".xml", ".html", ".svg":
		return ContentXML
	case ".gz", ".zip", ".tar.gz", ".tgz", ".zst", ".bz2", ".xz", ".7z":
		return ContentCompressed
	case ".tar":
		return ContentTar
	case ".vmdk", ".vhd", ".vhdx", ".qcow2", ".raw", ".img":
		return ContentVM
	case ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff":
		return ContentImage
	}

	// Check magic bytes
	if len(data) > 4 {
		magic := data[:4]
		if magic[0] == 0x1F && magic[1] == 0x8B {
			return ContentCompressed
		}
		if magic[0] == 0x28 && magic[1] == 0xB5 {
			return ContentCompressed
		}
		if magic[0] == 'P' && magic[1] == 'K' {
			return ContentCompressed
		}
		// Docker image layer
		if len(data) > 512 {
			if bytes.Contains(data[:512], []byte("LAYER")) {
				return ContentContainer
			}
		}
	}

	if isTextData(data) {
		if bytes.Contains(data, []byte("CREATE TABLE")) || bytes.Contains(data, []byte("INSERT INTO")) {
			return ContentSQL
		}
		if bytes.Contains(data, []byte("<?xml")) {
			return ContentXML
		}
		return ContentText
	}

	return ContentBinary
}

func isTextData(data []byte) bool {
	checkLen := len(data)
	if checkLen > 8192 {
		checkLen = 8192
	}
	nonText := 0
	for _, b := range data[:checkLen] {
		if b == 0 {
			return false
		}
		if b < 0x09 || (b > 0x0D && b < 0x20) {
			nonText++
		}
	}
	return nonText < checkLen/10
}

func (cab *ContentAwareBackup) ComputeDelta(ctx context.Context, oldFile, newFile string) ([]DeltaBlock, error) {
	oldData, err := os.ReadFile(oldFile)
	if err != nil {
		return nil, fmt.Errorf("read old: %w", err)
	}

	newData, err := os.ReadFile(newFile)
	if err != nil {
		return nil, fmt.Errorf("read new: %w", err)
	}

	cType := cab.DetectType(newFile, newData)
	cab.logger.Info("content type detected",
		zap.String("file", newFile),
		zap.String("type", string(cType)),
	)

	switch cType {
	case ContentSQL, ContentJSON, ContentXML, ContentText:
		return cab.textDelta(oldData, newData)
	default:
		return cab.binaryDelta(oldData, newData)
	}
}

func (cab *ContentAwareBackup) textDelta(old, new []byte) ([]DeltaBlock, error) {
	oldLines := bytes.Split(old, []byte("\n"))
	newLines := bytes.Split(new, []byte("\n"))

	type lineHash struct {
		hash string
		data []byte
	}

	oldMap := make(map[string][]byte)
	for _, line := range oldLines {
		h := sha256.Sum256(line)
		oldMap[hex.EncodeToString(h[:])] = line
	}

	var blocks []DeltaBlock

	for i, line := range newLines {
		h := sha256.Sum256(line)
		hashStr := hex.EncodeToString(h[:])

		if _, exists := oldMap[hashStr]; !exists {
			offset := int64(0)
			for j := 0; j < i; j++ {
				offset += int64(len(newLines[j]) + 1)
			}

			blocks = append(blocks, DeltaBlock{
				Offset:      offset,
				Size:        len(line),
				NewChecksum: hashStr,
				Data:        line,
			})
		}
	}

	return blocks, nil
}

func (cab *ContentAwareBackup) binaryDelta(old, new []byte) ([]DeltaBlock, error) {
	blockSize := 4096
	var blocks []DeltaBlock

	maxLen := len(old)
	if len(new) > maxLen {
		maxLen = len(new)
	}

	for offset := 0; offset < maxLen; offset += blockSize {
		oldBlock := getBlock(old, offset, blockSize)
		newBlock := getBlock(new, offset, blockSize)

		oldHash := sha256.Sum256(oldBlock)
		newHash := sha256.Sum256(newBlock)

		if !bytes.Equal(oldHash[:], newHash[:]) {
			blocks = append(blocks, DeltaBlock{
				Offset:      int64(offset),
				Size:        len(newBlock),
				OldChecksum: hex.EncodeToString(oldHash[:]),
				NewChecksum: hex.EncodeToString(newHash[:]),
				Data:        newBlock,
			})
		}
	}

	return blocks, nil
}

func getBlock(data []byte, offset, size int) []byte {
	if offset >= len(data) {
		return nil
	}
	end := offset + size
	if end > len(data) {
		end = len(data)
	}
	return data[offset:end]
}

func (cab *ContentAwareBackup) ApplyDelta(baseFile string, blocks []DeltaBlock) ([]byte, error) {
	base, err := os.ReadFile(baseFile)
	if err != nil {
		base = nil
	}

	var result []byte
	if base != nil {
		result = make([]byte, len(base))
		copy(result, base)
	}

	for _, block := range blocks {
		if block.Offset+int64(block.Size) > int64(len(result)) {
			newResult := make([]byte, block.Offset+int64(block.Size))
			copy(newResult, result)
			result = newResult
		}

		if block.Data != nil {
			copy(result[block.Offset:], block.Data)
		}
	}

	return result, nil
}

func (cab *ContentAwareBackup) BackupSmart(ctx context.Context, sourcePath, baseSnapshotPath string, progressCh chan<- BackupProgress) (*Snapshot, error) {
	type snapData struct {
		Files []struct {
			Path     string `json:"path"`
			Checksum string `json:"checksum"`
			Size     int64  `json:"size"`
		} `json:"files"`
	}

	var baseFiles map[string]string
	if baseSnapshotPath != "" {
		baseData, err := os.ReadFile(baseSnapshotPath)
		if err == nil {
			var base snapData
			json.Unmarshal(baseData, &base)
			baseFiles = make(map[string]string)
			for _, f := range base.Files {
				baseFiles[f.Path] = f.Checksum
			}
		}
	}

	snapshot := &Snapshot{
		ID:        TimestampFilename(),
		StartTime: time.Now(),
		Chunks:    make(map[string]*ChunkInfo),
	}

	scanner := NewScanner(nil)
	files, err := scanner.Scan(sourcePath)
	if err != nil {
		return nil, err
	}
	snapshot.Files = files
	snapshot.FileCount = int64(len(files))

	dedup := NewDedupStore()
	deltaSaved := int64(0)

	for _, f := range files {
		if f.IsDir || f.IsSymlink {
			continue
		}

		fullPath := filepath.Join(sourcePath, filepath.FromSlash(f.Path))
		data, err := os.ReadFile(fullPath)
		if err != nil {
			continue
		}

		// Check if file unchanged since last backup
		h := sha256.Sum256(data)
		currentChecksum := hex.EncodeToString(h[:])
		f.Checksum = currentChecksum

		if baseFiles != nil {
			if oldChecksum, exists := baseFiles[f.Path]; exists && oldChecksum == currentChecksum {
				deltaSaved += f.Size
				continue
			}
		}

		chunks := cab.chunker.ChunkData(data)
		for _, chunk := range chunks {
			chunkID := chunk.ID()
			if !dedup.IsUnique(chunkID) {
				continue
			}

			compressed, _ := cab.compressor.Compress(chunk)

			chunkInfo := &ChunkInfo{
				ID:   chunkID,
				Size: int64(len(compressed)),
				Hash: chunkID,
			}
			f.Chunks = append(f.Chunks, *chunkInfo)
			snapshot.Chunks[chunkID] = chunkInfo
		}
	}

	snapshot.EndTime = time.Now()

	cab.logger.Info("content-aware backup completed",
		zap.Int64("files", snapshot.FileCount),
		zap.Int64("chunks", snapshot.ChunkCount),
		zap.Int64("skipped_bytes", deltaSaved),
	)

	return snapshot, nil
}
