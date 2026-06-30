package backup

const (
	windowSize     = 64
	chunkMinSize   = 512 * 1024       // 512KB minimum
	chunkAvgSize   = 4 * 1024 * 1024  // 4MB target average
	chunkMaxSize   = 16 * 1024 * 1024 // 16MB maximum
	buzhashPrime   = 0x3FB6A5C5       // 32-bit prime
)

type CDCChunker struct {
	avgSize   int64
	minSize   int64
	maxSize   int64
	buzTable  [256]uint32
}

func NewCDCChunker(avgSize int64) *CDCChunker {
	if avgSize <= 0 {
		avgSize = chunkAvgSize
	}

	c := &CDCChunker{
		avgSize: avgSize,
		minSize: avgSize / 8,
		maxSize: avgSize * 4,
	}

	rng := newXorShift(42)
	for i := range c.buzTable {
		c.buzTable[i] = rng.next()
	}

	return c
}

type xorShift struct {
	state uint64
}

func newXorShift(seed uint64) *xorShift {
	if seed == 0 {
		seed = 1
	}
	return &xorShift{state: seed}
}

func (x *xorShift) next() uint32 {
	x.state ^= x.state >> 12
	x.state ^= x.state << 25
	x.state ^= x.state >> 27
	return uint32(x.state * 2685821657736338717)
}

func (c *CDCChunker) ChunkData(data []byte) []Chunk {
	if int64(len(data)) <= c.minSize {
		return []Chunk{Chunk(data)}
	}

	var chunks []Chunk

	hash := uint32(0)
	window := make([]byte, 0, windowSize)
	blockStart := int64(0)

	mask := uint32((c.avgSize / windowSize) - 1)

	for i := int64(0); i < int64(len(data)); i++ {
		b := data[i]

		window = append(window, b)
		hash = (hash ^ c.buzTable[b]) * buzhashPrime

		if len(window) > windowSize {
			old := window[0]
			window = window[1:]
			hash = (hash ^ c.buzTable[old]) * buzhashPrime
		}

		chunkLen := i - blockStart

		if chunkLen >= c.maxSize {
			chunks = append(chunks, Chunk(data[blockStart:i+1]))
			blockStart = i + 1
			hash = 0
			window = window[:0]
			continue
		}

		if chunkLen >= c.minSize && (hash&mask) == 0 {
			chunks = append(chunks, Chunk(data[blockStart:i+1]))
			blockStart = i + 1
			hash = 0
			window = window[:0]
		}
	}

	if blockStart < int64(len(data)) {
		chunks = append(chunks, Chunk(data[blockStart:]))
	}

	return chunks
}

type DedupStore struct {
	chunks map[string]struct{}
}

func NewDedupStore() *DedupStore {
	return &DedupStore{
		chunks: make(map[string]struct{}),
	}
}

func (d *DedupStore) IsUnique(id string) bool {
	if _, exists := d.chunks[id]; exists {
		return false
	}
	d.chunks[id] = struct{}{}
	return true
}

func (d *DedupStore) Add(id string) {
	d.chunks[id] = struct{}{}
}

func (d *DedupStore) Has(id string) bool {
	_, exists := d.chunks[id]
	return exists
}

func (d *DedupStore) Size() int {
	return len(d.chunks)
}
