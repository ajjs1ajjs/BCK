package backup

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Scanner struct {
	excludePatterns []string
}

func NewScanner(excludePatterns []string) *Scanner {
	return &Scanner{excludePatterns: excludePatterns}
}

func (s *Scanner) Scan(rootPath string) ([]*FileEntry, error) {
	var files []*FileEntry

	err := filepath.WalkDir(rootPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			files = append(files, &FileEntry{
				Path:  path,
				Error: err.Error(),
			})
			return nil
		}

		relPath, err := filepath.Rel(rootPath, path)
		if err != nil {
			relPath = path
		}

		if s.shouldExclude(relPath) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		info, err := d.Info()
		if err != nil {
			files = append(files, &FileEntry{
				Path:  relPath,
				Error: err.Error(),
			})
			return nil
		}

		entry := &FileEntry{
			Path:    filepath.ToSlash(relPath),
			Size:    info.Size(),
			Mode:    uint32(info.Mode()),
			ModTime: info.ModTime(),
			IsDir:   info.IsDir(),
		}

		if info.Mode()&os.ModeSymlink != 0 {
			entry.IsSymlink = true
			dest, err := os.Readlink(path)
			if err == nil {
				entry.SymlinkDest = dest
			}
		}

		files = append(files, entry)

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("scan directory: %w", err)
	}

	return files, nil
}

func (s *Scanner) shouldExclude(path string) bool {
	name := filepath.Base(path)
	for _, pattern := range s.excludePatterns {
		if matched, _ := filepath.Match(pattern, name); matched {
			return true
		}
		if matched, _ := filepath.Match(pattern, path); matched {
			return true
		}
		if strings.HasPrefix(name, ".") && pattern == ".*" {
			return true
		}
	}
	return false
}

func FileInfo(path string) (*FileEntry, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	return &FileEntry{
		Path:    filepath.ToSlash(path),
		Size:    info.Size(),
		Mode:    uint32(info.Mode()),
		ModTime: info.ModTime(),
		IsDir:   info.IsDir(),
	}, nil
}

func TimestampFilename() string {
	return time.Now().UTC().Format("2006-01-02T15-04-05")
}
