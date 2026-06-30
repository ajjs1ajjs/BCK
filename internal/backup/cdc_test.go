package backup

import (
	"testing"
)

func TestCDCChunker_Basic(t *testing.T) {
	c := NewCDCChunker(4 * 1024 * 1024)

	data := make([]byte, 10*1024*1024) // 10MB
	for i := range data {
		data[i] = byte(i % 256)
	}

	chunks := c.ChunkData(data)

	if len(chunks) == 0 {
		t.Fatal("expected at least one chunk")
	}

	if len(chunks) == 1 {
		t.Log("only one chunk produced for 10MB data - CDC may need tuning")
	}

	totalSize := int64(0)
	for _, ch := range chunks {
		totalSize += ch.Size()
	}

	if totalSize != int64(len(data)) {
		t.Errorf("total chunk size mismatch: got %d, want %d", totalSize, len(data))
	}

	t.Logf("Produced %d chunks from %d bytes (avg chunk size: %d)", len(chunks), len(data), totalSize/int64(len(chunks)))
}

func TestCDCChunker_Deterministic(t *testing.T) {
	c := NewCDCChunker(1024 * 1024) // 1MB target

	data := []byte("the quick brown fox jumps over the lazy dog. ")
	// Repeat to make meaningful data
	for i := 0; i < 10000; i++ {
		data = append(data, []byte("the quick brown fox jumps over the lazy dog. ")...)
	}

	chunks1 := c.ChunkData(data)
	chunks2 := c.ChunkData(data)

	if len(chunks1) != len(chunks2) {
		t.Fatalf("non-deterministic: run1=%d chunks, run2=%d chunks", len(chunks1), len(chunks2))
	}

	for i := range chunks1 {
		if chunks1[i].ID() != chunks2[i].ID() {
			t.Errorf("chunk %d differs between runs", i)
		}
	}
}

func TestChunker_FixedSize(t *testing.T) {
	c := NewChunker(1024)

	data := make([]byte, 5000)
	chunks := c.ChunkData(data)

	expectedChunks := 5 // 5000/1024 = 4.88 -> 5 chunks
	if len(chunks) != expectedChunks {
		t.Errorf("expected %d chunks, got %d", expectedChunks, len(chunks))
	}

	// First 4 chunks should be 1024 bytes
	for i := 0; i < 4; i++ {
		if chunks[i].Size() != 1024 {
			t.Errorf("chunk %d: expected size 1024, got %d", i, chunks[i].Size())
		}
	}

	// Last chunk should be remainder
	remainder := 5000 - 4*1024 // 904
	if chunks[4].Size() != int64(remainder) {
		t.Errorf("last chunk: expected size %d, got %d", remainder, chunks[4].Size())
	}
}

func TestCompressor_Roundtrip(t *testing.T) {
	c := NewCompressor(3)

	original := []byte("Hello, World! This is a test of the compression system. " +
		"It should compress and decompress data without loss. " +
		"Lorem ipsum dolor sit amet, consectetur adipiscing elit.")

	compressed, err := c.Compress(original)
	if err != nil {
		t.Fatalf("compress failed: %v", err)
	}
	if len(compressed) == 0 {
		t.Fatal("compressed data is empty")
	}

	decompressed, err := c.Decompress(compressed)
	if err != nil {
		t.Fatalf("decompress failed: %v", err)
	}

	if string(decompressed) != string(original) {
		t.Errorf("roundtrip failed: decompressed data doesn't match original")
	}

	t.Logf("Compression ratio: %.2f%% (original=%d -> compressed=%d)",
		float64(len(compressed))/float64(len(original))*100,
		len(original), len(compressed))
}

func TestEncryptor_Roundtrip(t *testing.T) {
	key := []byte("this-is-a-32-byte-test-key!!!!!") // exactly 32 bytes
	enc, err := NewEncryptor(key)
	if err != nil {
		t.Fatalf("create encryptor: %v", err)
	}

	original := []byte("sensitive backup data that needs encryption")

	encrypted, err := enc.Encrypt(original)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}

	decrypted, err := enc.Decrypt(encrypted)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}

	if string(decrypted) != string(original) {
		t.Errorf("roundtrip failed: got %q, want %q", decrypted, original)
	}
}

func TestEncryptor_DerivedKey(t *testing.T) {
	password := []byte("user-password-123")
	key1 := DeriveKey(password)
	key2 := DeriveKey(password)

	if len(key1) != 32 {
		t.Errorf("expected key length 32, got %d", len(key1))
	}

	// Same password should produce same key
	for i := range key1 {
		if key1[i] != key2[i] {
			t.Errorf("key mismatch at position %d: %x != %x", i, key1[i], key2[i])
			break
		}
	}
}

func TestScanner_ExcludePatterns(t *testing.T) {
	t.Skip("requires filesystem - integration test")
}

func TestDedupStore_Unique(t *testing.T) {
	ds := NewDedupStore()

	if !ds.IsUnique("abc123") {
		t.Error("first insert should be unique")
	}
	if ds.IsUnique("abc123") {
		t.Error("duplicate should not be unique")
	}

	if ds.Size() != 1 {
		t.Errorf("expected size 1, got %d", ds.Size())
	}
}
