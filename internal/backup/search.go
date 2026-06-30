package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type SearchResult struct {
	SnapshotID string `json:"snapshot_id"`
	FilePath   string `json:"file_path"`
	Size       int64  `json:"size"`
	ModTime    string `json:"mod_time"`
	MatchType  string `json:"match_type"` // filename, content, pattern
}

type FileBrowser struct {
	Path     string        `json:"path"`
	Name     string        `json:"name"`
	IsDir    bool          `json:"is_dir"`
	Size     int64         `json:"size"`
	Mode     uint32        `json:"mode"`
	ModTime  string        `json:"mod_time"`
	Children []*FileBrowser `json:"children,omitempty"`
}

type SearchEngine struct {
	db      *pgxpool.Pool
	logger  *zap.Logger
	index   map[string][]string // snapshotID -> file paths
	mu      sync.RWMutex
}

func NewSearchEngine(db *pgxpool.Pool, logger *zap.Logger) *SearchEngine {
	return &SearchEngine{
		db:    db,
		logger: logger,
		index: make(map[string][]string),
	}
}

func (se *SearchEngine) SearchByFilename(ctx context.Context, repoID, query string) ([]SearchResult, error) {
	rows, err := se.db.Query(ctx,
		`SELECT s.id, s.snapshot_path, s.created_at
		 FROM snapshots s
		 WHERE s.repository_id = $1 AND s.snapshot_path ILIKE '%' || $2 || '%'
		 ORDER BY s.created_at DESC LIMIT 50`,
		repoID, query,
	)
	if err != nil {
		return nil, fmt.Errorf("search snapshots: %w", err)
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var r SearchResult
		var createdAt string
		if err := rows.Scan(&r.SnapshotID, &r.FilePath, &createdAt); err != nil {
			continue
		}
		r.MatchType = "filename"
		r.ModTime = createdAt
		results = append(results, r)
	}

	return results, nil
}

func (se *SearchEngine) SearchGlobal(ctx context.Context, query string) ([]SearchResult, error) {
	// Search across all snapshots, jobs, and repositories
	rows, err := se.db.Query(ctx,
		`SELECT 'snapshot' as type, id, snapshot_path, created_at FROM snapshots WHERE snapshot_path ILIKE '%' || $1 || '%'
		 UNION ALL
		 SELECT 'job', id, name, created_at FROM backup_jobs WHERE name ILIKE '%' || $1 || '%'
		 UNION ALL
		 SELECT 'repo', id, name, created_at FROM repositories WHERE name ILIKE '%' || $1 || '%'
		 ORDER BY created_at DESC LIMIT 50`,
		query,
	)
	if err != nil {
		return nil, fmt.Errorf("global search: %w", err)
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var r SearchResult
		var matchType, createdAt string
		if err := rows.Scan(&matchType, &r.SnapshotID, &r.FilePath, &createdAt); err != nil {
			continue
		}
		r.MatchType = matchType
		r.ModTime = createdAt
		results = append(results, r)
	}

	return results, nil
}

func (se *SearchEngine) BrowseSnapshot(ctx context.Context, snapshotID, localRepoPath string) (*FileBrowser, error) {
	var snapshotPath string
	err := se.db.QueryRow(ctx,
		`SELECT snapshot_path FROM snapshots WHERE id = $1`, snapshotID,
	).Scan(&snapshotPath)
	if err != nil {
		return nil, fmt.Errorf("snapshot not found: %w", err)
	}

	fullPath := filepath.Join(localRepoPath, "snapshots", snapshotPath+".json")
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		fullPath = filepath.Join(localRepoPath, snapshotPath+".json")
	}

	snapshotFile, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, fmt.Errorf("read snapshot: %w", err)
	}

	type snapFile struct {
		Path     string `json:"path"`
		Size     int64  `json:"size"`
		Mode     uint32 `json:"mode"`
		ModTime  string `json:"mod_time"`
		IsDir    bool   `json:"is_dir"`
		IsSymlink bool  `json:"is_symlink"`
	}

	type snapshotData struct {
		Files []snapFile `json:"files"`
	}

	var data snapshotData
	json.Unmarshal(snapshotFile, &data)

	root := &FileBrowser{
		Path:     "/",
		Name:     "/",
		IsDir:    true,
		Children: make([]*FileBrowser, 0),
	}

	dirMap := make(map[string]*FileBrowser)
	dirMap["/"] = root

	for _, f := range data.Files {
		dir := filepath.Dir(f.Path)
		if dir == "." {
			dir = "/"
		}

		entry := &FileBrowser{
			Path:    f.Path,
			Name:    filepath.Base(f.Path),
			IsDir:   f.IsDir,
			Size:    f.Size,
			Mode:    f.Mode,
			ModTime: f.ModTime,
		}

		if f.IsDir {
			entry.Children = make([]*FileBrowser, 0)
			dirMap[f.Path] = entry
		}

		parent, ok := dirMap[dir]
		if ok {
			parent.Children = append(parent.Children, entry)
		}
	}

	return root, nil
}

func (se *SearchEngine) GetFileInfo(ctx context.Context, snapshotID, filePath string) (*SearchResult, error) {
	return &SearchResult{
		SnapshotID: snapshotID,
		FilePath:   filePath,
		MatchType:  "exact",
	}, nil
}

func (se *SearchEngine) IndexSnapshot(snapshotID string, files []string) {
	se.mu.Lock()
	defer se.mu.Unlock()
	se.index[snapshotID] = files
}

func (se *SearchEngine) FindByPattern(pattern string) []string {
	se.mu.RLock()
	defer se.mu.RUnlock()

	var matches []string
	for _, files := range se.index {
		for _, f := range files {
			if matched, _ := filepath.Match(pattern, filepath.Base(f)); matched {
				matches = append(matches, f)
			}
		}
	}
	return matches
}
