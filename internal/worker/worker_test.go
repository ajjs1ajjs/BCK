package worker

import (
	"testing"

	"github.com/ajjs1ajjs/BCK/internal/backup"
)

func TestChunkID_Deterministic(t *testing.T) {
	data := []byte("test chunk data")
	chunk := backup.Chunk(data)

	id1 := chunk.ID()
	id2 := chunk.ID()

	if id1 != id2 {
		t.Errorf("chunk ID not deterministic: %s vs %s", id1, id2)
	}
}

func TestChunkID_DifferentData(t *testing.T) {
	chunk1 := backup.Chunk([]byte("data one"))
	chunk2 := backup.Chunk([]byte("data two"))

	if chunk1.ID() == chunk2.ID() {
		t.Error("different data should produce different chunk IDs")
	}
}
