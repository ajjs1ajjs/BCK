package backup

import (
	"sync"
	"time"
)

type CacheEntry struct {
	Data       []byte
	ExpiresAt  time.Time
	LastAccess time.Time
}

type ChunkCache struct {
	entries    map[string]*CacheEntry
	mu         sync.RWMutex
	maxSize    int64
	currentSize int64
	ttl        time.Duration
}

func NewChunkCache(maxMB int, ttl time.Duration) *ChunkCache {
	return &ChunkCache{
		entries: make(map[string]*CacheEntry),
		maxSize: int64(maxMB) * 1024 * 1024,
		ttl:     ttl,
	}
}

func (cc *ChunkCache) Get(id string) ([]byte, bool) {
	cc.mu.RLock()
	entry, exists := cc.entries[id]
	cc.mu.RUnlock()

	if !exists {
		return nil, false
	}

	if time.Now().After(entry.ExpiresAt) {
		cc.mu.Lock()
		delete(cc.entries, id)
		cc.currentSize -= int64(len(entry.Data))
		cc.mu.Unlock()
		return nil, false
	}

	entry.LastAccess = time.Now()
	return entry.Data, true
}

func (cc *ChunkCache) Set(id string, data []byte) {
	size := int64(len(data))

	cc.mu.Lock()
	defer cc.mu.Unlock()

	if cc.currentSize+size > cc.maxSize {
		cc.evict(size)
	}

	cc.entries[id] = &CacheEntry{
		Data:       data,
		ExpiresAt:  time.Now().Add(cc.ttl),
		LastAccess: time.Now(),
	}
	cc.currentSize += size
}

func (cc *ChunkCache) evict(needed int64) {
	var oldestID string
	var oldestTime time.Time

	for id, entry := range cc.entries {
		if oldestID == "" || entry.LastAccess.Before(oldestTime) {
			oldestID = id
			oldestTime = entry.LastAccess
		}
	}

	if oldestID != "" {
		cc.currentSize -= int64(len(cc.entries[oldestID].Data))
		delete(cc.entries, oldestID)
	}
}

func (cc *ChunkCache) Size() int64 {
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	return cc.currentSize
}

type ParallelUploader struct {
	concurrency int
	cache       *ChunkCache
}

func NewParallelUploader(concurrency int, cache *ChunkCache) *ParallelUploader {
	if concurrency <= 0 {
		concurrency = 8
	}
	return &ParallelUploader{
		concurrency: concurrency,
		cache:       cache,
	}
}

type uploadJob struct {
	chunkID string
	data    []byte
}

func (p *ParallelUploader) UploadAll(chunks map[string][]byte, storeFn func(string, []byte) error) error {
	jobs := make(chan uploadJob, len(chunks))
	errs := make(chan error, len(chunks))

	var wg sync.WaitGroup

	for i := 0; i < p.concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				if p.cache != nil {
					if cached, ok := p.cache.Get(job.chunkID); ok && len(cached) == len(job.data) {
						continue
					}
				}

				if err := storeFn(job.chunkID, job.data); err != nil {
					errs <- err
					return
				}

				if p.cache != nil {
					p.cache.Set(job.chunkID, job.data)
				}
			}
		}()
	}

	for id, data := range chunks {
		jobs <- uploadJob{chunkID: id, data: data}
	}
	close(jobs)

	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			return err
		}
	}

	return nil
}

type CompressionAutoTuner struct {
	levels       []int
	currentLevel int
	scores       []float64
	mu           sync.Mutex
}

func NewCompressionAutoTuner() *CompressionAutoTuner {
	return &CompressionAutoTuner{
		levels:       []int{1, 3, 5, 7, 9},
		currentLevel: 3,
		scores:       make([]float64, 5),
	}
}

func (ct *CompressionAutoTuner) Record(level int, originalSize, compressedSize int64, duration time.Duration) {
	ratio := float64(originalSize) / float64(compressedSize)
	speed := float64(originalSize) / duration.Seconds() / (1024 * 1024)

	score := ratio*0.4 + speed*0.6

	ct.mu.Lock()
	defer ct.mu.Unlock()

	for i, l := range ct.levels {
		if l == level {
			if ct.scores[i] == 0 {
				ct.scores[i] = score
			} else {
				ct.scores[i] = ct.scores[i]*0.7 + score*0.3
			}
			break
		}
	}

	bestLevel := ct.levels[0]
	bestScore := ct.scores[0]
	for i, s := range ct.scores {
		if s > bestScore {
			bestScore = s
			bestLevel = ct.levels[i]
		}
	}
	ct.currentLevel = bestLevel
}

func (ct *CompressionAutoTuner) GetOptimalLevel() int {
	ct.mu.Lock()
	defer ct.mu.Unlock()
	return ct.currentLevel
}

type ConnectionPool struct {
	sem     chan struct{}
	mu      sync.Mutex
	active  int
	max     int
}

func NewConnectionPool(max int) *ConnectionPool {
	return &ConnectionPool{
		sem: make(chan struct{}, max),
		max: max,
	}
}

func (cp *ConnectionPool) Acquire() {
	cp.sem <- struct{}{}
	cp.mu.Lock()
	cp.active++
	cp.mu.Unlock()
}

func (cp *ConnectionPool) Release() {
	<-cp.sem
	cp.mu.Lock()
	cp.active--
	cp.mu.Unlock()
}

func (cp *ConnectionPool) Active() int {
	cp.mu.Lock()
	defer cp.mu.Unlock()
	return cp.active
}

func (cp *ConnectionPool) Available() int {
	return cp.max - cp.Active()
}
