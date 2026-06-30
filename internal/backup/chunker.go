package backup

import (
	"crypto/sha256"
	"fmt"
	"io"
)

const DefaultChunkSize = 4 * 1024 * 1024 // 4MB

type Chunker struct {
	chunkSize int64
}

func NewChunker(chunkSize int64) *Chunker {
	if chunkSize <= 0 {
		chunkSize = DefaultChunkSize
	}
	return &Chunker{chunkSize: chunkSize}
}

func (c *Chunker) ChunkReader(reader io.Reader) ([]Chunk, error) {
	var chunks []Chunk
	buf := make([]byte, c.chunkSize)

	for {
		n, err := io.ReadFull(reader, buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			chunks = append(chunks, chunk)
		}
		if err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				break
			}
			return nil, fmt.Errorf("read chunk: %w", err)
		}
	}

	return chunks, nil
}

func (c *Chunker) ChunkData(data []byte) []Chunk {
	var chunks []Chunk
	for i := int64(0); i < int64(len(data)); i += c.chunkSize {
		end := i + c.chunkSize
		if end > int64(len(data)) {
			end = int64(len(data))
		}
		chunk := make([]byte, end-i)
		copy(chunk, data[i:end])
		chunks = append(chunks, chunk)
	}
	return chunks
}

type Chunk []byte

func (ch Chunk) ID() string {
	return fmt.Sprintf("%x", sha256.Sum256(ch))
}

func (ch Chunk) Size() int64 {
	return int64(len(ch))
}
