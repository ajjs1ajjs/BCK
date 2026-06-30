package backup

import (
	"fmt"

	"github.com/klauspost/compress/zstd"
)

type Compressor struct {
	level int
}

func NewCompressor(level int) *Compressor {
	if level < 1 {
		level = 3
	}
	if level > 22 {
		level = 22
	}
	return &Compressor{level: level}
}

func (c *Compressor) Compress(data []byte) ([]byte, error) {
	encoder, err := zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.EncoderLevelFromZstd(c.level)))
	if err != nil {
		return nil, fmt.Errorf("create encoder: %w", err)
	}
	defer encoder.Close()

	compressed := encoder.EncodeAll(data, nil)
	return compressed, nil
}

func (c *Compressor) Decompress(data []byte) ([]byte, error) {
	decoder, err := zstd.NewReader(nil)
	if err != nil {
		return nil, fmt.Errorf("create decoder: %w", err)
	}
	defer decoder.Close()

	decompressed, err := decoder.DecodeAll(data, nil)
	if err != nil {
		return nil, fmt.Errorf("decompress: %w", err)
	}

	return decompressed, nil
}
