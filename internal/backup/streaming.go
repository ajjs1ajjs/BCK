package backup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"go.uber.org/zap"
)

type StreamConfig struct {
	Brokers      []string      `json:"brokers"`
	Topic        string        `json:"topic"`
	ConsumerGroup string       `json:"consumer_group"`
	Partitions   int           `json:"partitions"`
	BatchSize    int           `json:"batch_size"`
	FlushInterval time.Duration `json:"flush_interval"`
}

type StreamRecord struct {
	Offset    int64             `json:"offset"`
	Partition int               `json:"partition"`
	Key       string            `json:"key,omitempty"`
	Value     []byte            `json:"value"`
	Timestamp time.Time         `json:"timestamp"`
	Headers   map[string]string `json:"headers,omitempty"`
}

type StreamBackup struct {
	ID          string    `json:"id"`
	Topic       string    `json:"topic"`
	StartOffset int64     `json:"start_offset"`
	EndOffset   int64     `json:"end_offset"`
	RecordCount int64     `json:"record_count"`
	SizeBytes   int64     `json:"size_bytes"`
	StartedAt   time.Time `json:"started_at"`
	CompletedAt time.Time `json:"completed_at"`
	Checksum    string    `json:"checksum"`
	Partitions  []PartitionBackup `json:"partitions"`
}

type PartitionBackup struct {
	Partition    int   `json:"partition"`
	StartOffset  int64 `json:"start_offset"`
	EndOffset    int64 `json:"end_offset"`
	RecordCount  int64 `json:"record_count"`
}

type StreamingManager struct {
	configs  map[string]*StreamConfig
	backups  map[string]*StreamBackup
	mu       sync.RWMutex
	logger   *zap.Logger
}

func NewStreamingManager(logger *zap.Logger) *StreamingManager {
	return &StreamingManager{
		configs: make(map[string]*StreamConfig),
		backups: make(map[string]*StreamBackup),
		logger:  logger,
	}
}

func (sm *StreamingManager) RegisterStream(config *StreamConfig) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.configs[config.Topic] = config
	sm.logger.Info("stream registered",
		zap.String("topic", config.Topic),
		zap.Int("partitions", config.Partitions),
	)
}

func (sm *StreamingManager) BackupStream(ctx context.Context, topic string, repoPath string, progressCh chan<- BackupProgress) (*StreamBackup, error) {
	config, exists := sm.configs[topic]
	if !exists {
		return nil, fmt.Errorf("stream not registered: %s", topic)
	}

	backup := &StreamBackup{
		ID:         fmt.Sprintf("stream-%s-%s", topic, TimestampFilename()),
		Topic:      topic,
		StartedAt:  time.Now(),
		Partitions: make([]PartitionBackup, 0),
	}

	sm.logger.Info("starting stream backup",
		zap.String("topic", topic),
		zap.Int("partitions", config.Partitions),
	)

	var totalRecords int64
	var totalSize int64
	var wg sync.WaitGroup
	var mu sync.Mutex

	type result struct {
		partition   int
		records     []StreamRecord
		totalBytes  int64
	}

	resultCh := make(chan result, config.Partitions)

	for p := 0; p < config.Partitions; p++ {
		wg.Add(1)
		go func(partition int) {
			defer wg.Done()

			records := sm.simulateReadPartition(ctx, config, partition)
			var bytes int64
			for _, r := range records {
				bytes += int64(len(r.Value))
			}

			resultCh <- result{
				partition:  partition,
				records:    records,
				totalBytes: bytes,
			}
		}(p)
	}

	go func() {
		wg.Wait()
		close(resultCh)
	}()

	for r := range resultCh {
		mu.Lock()
		totalRecords += int64(len(r.records))
		totalSize += r.totalBytes

		backup.Partitions = append(backup.Partitions, PartitionBackup{
			Partition:   r.partition,
			RecordCount: int64(len(r.records)),
		})
		mu.Unlock()
	}

	backup.RecordCount = totalRecords
	backup.SizeBytes = totalSize
	backup.CompletedAt = time.Now()
	backup.Checksum = computeStreamChecksum(backup)

	// Store stream backup metadata
	backupPath := repoPath + "/stream-backups"
	os.MkdirAll(backupPath, 0700)
	os.MkdirAll(backupPath, 0700)
	data, _ := json.MarshalIndent(backup, "", "  ")
	os.WriteFile(backupPath+"/"+backup.ID+".json", data, 0600)

	sm.mu.Lock()
	sm.backups[backup.ID] = backup
	sm.mu.Unlock()

	sm.logger.Info("stream backup completed",
		zap.String("topic", topic),
		zap.Int64("records", totalRecords),
		zap.Int64("bytes", totalSize),
	)

	return backup, nil
}

func (sm *StreamingManager) simulateReadPartition(ctx context.Context, config *StreamConfig, partition int) []StreamRecord {
	batchSize := config.BatchSize
	if batchSize == 0 {
		batchSize = 1000
	}

	records := make([]StreamRecord, 0, batchSize)

	for i := 0; i < batchSize; i++ {
		records = append(records, StreamRecord{
			Offset:    int64(i),
			Partition: partition,
			Key:       fmt.Sprintf("key-%d-%d", partition, i),
			Value:     []byte(fmt.Sprintf(`{"event":"backup_event_%d_%d","timestamp":"%s"}`, partition, i, time.Now().Format(time.RFC3339))),
			Timestamp: time.Now(),
		})
	}

	return records
}

func computeStreamChecksum(backup *StreamBackup) string {
	data := fmt.Sprintf("%s-%d-%d", backup.Topic, backup.RecordCount, backup.SizeBytes)
	h := sha256.Sum256([]byte(data))
	return hex.EncodeToString(h[:])
}

func (sm *StreamingManager) RestoreStream(ctx context.Context, backupID, targetTopic string) error {
	backup, exists := sm.backups[backupID]
	if !exists {
		return fmt.Errorf("backup not found: %s", backupID)
	}

	sm.logger.Info("restoring stream",
		zap.String("from", backup.Topic),
		zap.String("to", targetTopic),
		zap.Int64("records", backup.RecordCount),
	)

	return nil
}

type ExactlyOnceTracker struct {
	processed map[string]bool
	mu        sync.RWMutex
}

func NewExactlyOnceTracker() *ExactlyOnceTracker {
	return &ExactlyOnceTracker{
		processed: make(map[string]bool),
	}
}

func (eot *ExactlyOnceTracker) MarkProcessed(recordID string) bool {
	eot.mu.Lock()
	defer eot.mu.Unlock()
	if eot.processed[recordID] {
		return false
	}
	eot.processed[recordID] = true
	return true
}

func (eot *ExactlyOnceTracker) IsProcessed(recordID string) bool {
	eot.mu.RLock()
	defer eot.mu.RUnlock()
	return eot.processed[recordID]
}

func (eot *ExactlyOnceTracker) Size() int {
	eot.mu.RLock()
	defer eot.mu.RUnlock()
	return len(eot.processed)
}
