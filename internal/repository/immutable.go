package repository

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/ajjs1ajjs/BCK/internal/backup"
)

type ImmutableMode string

const (
	ImmutableNone       ImmutableMode = "none"
	ImmutableGovernance ImmutableMode = "governance"
	ImmutableCompliance ImmutableMode = "compliance"
)

type ImmutableConfig struct {
	Mode           ImmutableMode `json:"mode"`
	RetentionDays  int           `json:"retention_days"`  // Min days before data can be deleted
	LockUntil      time.Time     `json:"lock_until"`      // Absolute lock date
	LegalHold      bool          `json:"legal_hold"`      // Legal hold prevents any deletion
}

type LockRecord struct {
	ChunkID    string    `json:"chunk_id"`
	LockedAt   time.Time `json:"locked_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	LockedBy   string    `json:"locked_by"`
	Mode       ImmutableMode `json:"mode"`
}

type ImmutableRepo struct {
	LocalRepo
	cfg        ImmutableConfig
	locks      map[string]*LockRecord
	mu         sync.RWMutex
	lockDir    string
}

func NewImmutableRepo(basePath string, cfg ImmutableConfig) (*ImmutableRepo, error) {
	repo := &ImmutableRepo{
		LocalRepo: *NewLocalRepo(basePath),
		cfg:       cfg,
		locks:     make(map[string]*LockRecord),
		lockDir:   filepath.Join(basePath, "immutable-locks"),
	}

	if cfg.Mode != ImmutableNone {
		if err := os.MkdirAll(repo.lockDir, 0700); err != nil {
			return nil, fmt.Errorf("create lock dir: %w", err)
		}
	}

	return repo, nil
}

func (r *ImmutableRepo) StoreChunk(id string, data []byte) error {
	if err := r.LocalRepo.StoreChunk(id, data); err != nil {
		return err
	}

	if r.cfg.Mode != ImmutableNone {
		lockExpiry := time.Now().Add(time.Duration(r.cfg.RetentionDays) * 24 * time.Hour)
		if !r.cfg.LockUntil.IsZero() && r.cfg.LockUntil.After(lockExpiry) {
			lockExpiry = r.cfg.LockUntil
		}

		r.mu.Lock()
		r.locks[id] = &LockRecord{
			ChunkID:   id,
			LockedAt:  time.Now(),
			ExpiresAt: lockExpiry,
			LockedBy:  "system",
			Mode:      r.cfg.Mode,
		}
		r.mu.Unlock()

		r.persistLock(id)
	}
	return nil
}

func (r *ImmutableRepo) DeleteChunk(id string) error {
	if r.cfg.LegalHold {
		return fmt.Errorf("delete blocked: legal hold active")
	}

	r.mu.RLock()
	lock, exists := r.locks[id]
	r.mu.RUnlock()

	if exists {
		if r.cfg.Mode == ImmutableCompliance {
			return fmt.Errorf("delete blocked: compliance lock active until %s", lock.ExpiresAt.Format(time.RFC3339))
		}
		if time.Now().Before(lock.ExpiresAt) {
			return fmt.Errorf("delete blocked: retention lock until %s (governance mode)", lock.ExpiresAt.Format(time.RFC3339))
		}
	}

	return r.LocalRepo.DeleteChunk(id)
}

func (r *ImmutableRepo) DeleteSnapshot(id string) error {
	if r.cfg.LegalHold {
		return fmt.Errorf("delete blocked: legal hold active")
	}
	return r.LocalRepo.DeleteSnapshot(id)
}

func (r *ImmutableRepo) StoreSnapshot(snap *backup.Snapshot) error {
	return r.LocalRepo.StoreSnapshot(snap)
}

func (r *ImmutableRepo) LegalHold(enable bool) {
	r.cfg.LegalHold = enable
}

func (r *ImmutableRepo) GetLockInfo(chunkID string) (*LockRecord, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	lock, exists := r.locks[chunkID]
	return lock, exists
}

func (r *ImmutableRepo) ListLocks() []*LockRecord {
	r.mu.RLock()
	defer r.mu.RUnlock()

	locks := make([]*LockRecord, 0, len(r.locks))
	for _, lock := range r.locks {
		locks = append(locks, lock)
	}
	return locks
}

func (r *ImmutableRepo) Stats() (*RepoStats, error) {
	stats, err := r.LocalRepo.Stats()
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	stats.DedupeSaved = int64(len(r.locks))
	r.mu.RUnlock()
	return stats, nil
}

func (r *ImmutableRepo) persistLock(id string) {
	r.mu.RLock()
	lock := r.locks[id]
	r.mu.RUnlock()

	if lock == nil {
		return
	}

	data := fmt.Sprintf("%s|%d|%d|%s|%s\n",
		lock.ChunkID,
		lock.LockedAt.Unix(),
		lock.ExpiresAt.Unix(),
		lock.LockedBy,
		lock.Mode,
	)

	f, err := os.OpenFile(filepath.Join(r.lockDir, "locks.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	defer f.Close()
	f.WriteString(data)
}

func (r *ImmutableRepo) SnapshotRetentionLock(snapshotID string, days int) error {
	r.cfg.RetentionDays = days
	return nil
}
