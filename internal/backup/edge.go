package backup

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"net"
	"sort"
	"sync"
	"time"

	"go.uber.org/zap"
)

type EdgeNode struct {
	ID       string    `json:"id"`
	Region   string    `json:"region"`
	Host     string    `json:"host"`
	Port     int       `json:"port"`
	Latency  float64   `json:"latency_ms"`
	Capacity float64   `json:"capacity_gbps"`
	Load     float64   `json:"load_percent"`
	Status   string    `json:"status"` // online, degraded, offline
	LastSeen time.Time `json:"last_seen"`
}

type GeoRouter struct {
	nodes   map[string]*EdgeNode
	mu      sync.RWMutex
	logger  *zap.Logger
}

func NewGeoRouter(logger *zap.Logger) *GeoRouter {
	return &GeoRouter{
		nodes:  make(map[string]*EdgeNode),
		logger: logger,
	}
}

func (gr *GeoRouter) RegisterNode(node *EdgeNode) {
	gr.mu.Lock()
	defer gr.mu.Unlock()
	gr.nodes[node.ID] = node
	gr.logger.Info("edge node registered",
		zap.String("node", node.ID),
		zap.String("region", node.Region),
	)
}

func (gr *GeoRouter) RemoveNode(id string) {
	gr.mu.Lock()
	defer gr.mu.Unlock()
	delete(gr.nodes, id)
}

func (gr *GeoRouter) GetNearest(lat, lon float64) (*EdgeNode, error) {
	gr.mu.RLock()
	defer gr.mu.RUnlock()

	// Region coordinates (approximate centers)
	regionCoords := map[string][2]float64{
		"us-east-1":      {37.7749, -77.0369},
		"us-west-1":      {37.7749, -122.4194},
		"eu-west-1":      {53.3498, -6.2603},
		"eu-central-1":   {50.1109, 8.6821},
		"ap-southeast-1": {1.3521, 103.8198},
		"ap-northeast-1": {35.6762, 139.6503},
		"sa-east-1":      {-23.5505, -46.6333},
	}

	var nearest *EdgeNode
	bestScore := math.MaxFloat64

	for _, node := range gr.nodes {
		if node.Status != "online" {
			continue
		}

		coords, ok := regionCoords[node.Region]
		if !ok {
			continue
		}

		score := haversineDist(lat, lon, coords[0], coords[1]) +
			node.Latency/1000 +
			node.Load*0.01 -
			node.Capacity

		if score < bestScore {
			bestScore = score
			nearest = node
		}
	}

	if nearest == nil {
		return nil, fmt.Errorf("no online edge nodes available")
	}

	return nearest, nil
}

func haversineDist(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371 // Earth radius in km

	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

func (gr *GeoRouter) GetRegionNodes(region string) []*EdgeNode {
	gr.mu.RLock()
	defer gr.mu.RUnlock()

	var nodes []*EdgeNode
	for _, node := range gr.nodes {
		if node.Region == region && node.Status == "online" {
			nodes = append(nodes, node)
		}
	}
	return nodes
}

func (gr *GeoRouter) BalanceLoad(dataSize int64) (*EdgeNode, error) {
	gr.mu.RLock()
	defer gr.mu.RUnlock()

	type candidate struct {
		node  *EdgeNode
		score float64
	}

	var candidates []candidate
	for _, node := range gr.nodes {
		if node.Status != "online" {
			continue
		}
		candidates = append(candidates, candidate{
			node: node,
			score: (node.Capacity - node.Load) / (node.Latency + 1),
		})
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("no available nodes")
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].score > candidates[j].score
	})

	best := candidates[0]

	// Randomize among top 3 for better distribution
	if len(candidates) > 3 {
		best = candidates[rand.Intn(3)]
	}

	return best.node, nil
}

func (gr *GeoRouter) NodeCount() int {
	gr.mu.RLock()
	defer gr.mu.RUnlock()
	return len(gr.nodes)
}

type EdgeCacheEntry struct {
	Key        string    `json:"key"`
	Data       []byte    `json:"data"`
	NodeID     string    `json:"node_id"`
	CreatedAt  time.Time `json:"created_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	AccessCount int64    `json:"access_count"`
}

type EdgeCache struct {
	entries  map[string]*EdgeCacheEntry
	mu       sync.RWMutex
	maxSize  int64
	currSize int64
	logger   *zap.Logger
}

func NewEdgeCache(maxMB int, logger *zap.Logger) *EdgeCache {
	return &EdgeCache{
		entries: make(map[string]*EdgeCacheEntry),
		maxSize: int64(maxMB) * 1024 * 1024,
		logger:  logger,
	}
}

func (ec *EdgeCache) Put(key string, data []byte, nodeID string, ttl time.Duration) {
	ec.mu.Lock()
	defer ec.mu.Unlock()

	size := int64(len(data))

	if ec.currSize+size > ec.maxSize {
		ec.evict()
	}

	ec.entries[key] = &EdgeCacheEntry{
		Key:       key,
		Data:      data,
		NodeID:    nodeID,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(ttl),
	}
	ec.currSize += size
}

func (ec *EdgeCache) Get(key string) ([]byte, bool) {
	ec.mu.RLock()
	defer ec.mu.RUnlock()

	entry, exists := ec.entries[key]
	if !exists {
		return nil, false
	}

	if time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	entry.AccessCount++
	return entry.Data, true
}

func (ec *EdgeCache) evict() {
	var oldestKey string
	var oldestTime time.Time

	for key, entry := range ec.entries {
		if oldestKey == "" || entry.CreatedAt.Before(oldestTime) {
			oldestKey = key
			oldestTime = entry.CreatedAt
		}
	}

	if oldestKey != "" {
		ec.currSize -= int64(len(ec.entries[oldestKey].Data))
		delete(ec.entries, oldestKey)
	}
}

type SyncManager struct {
	router *GeoRouter
	cache  *EdgeCache
	logger *zap.Logger
}

func NewSyncManager(router *GeoRouter, cache *EdgeCache, logger *zap.Logger) *SyncManager {
	return &SyncManager{router: router, cache: cache, logger: logger}
}

func (sm *SyncManager) SyncToEdge(ctx context.Context, chunkID string, data []byte, region string) error {
	nodes := sm.router.GetRegionNodes(region)

	if len(nodes) == 0 {
		node, err := sm.router.BalanceLoad(int64(len(data)))
		if err != nil {
			return fmt.Errorf("no edge nodes: %w", err)
		}
		nodes = append(nodes, node)
	}

	for _, node := range nodes {
		sm.logger.Info("syncing to edge node",
			zap.String("chunk", chunkID),
			zap.String("node", node.ID),
			zap.String("region", node.Region),
		)

		if node.Host == "" {
			continue
		}

		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", node.Host, node.Port), 5*time.Second)
		if err != nil {
			sm.logger.Warn("edge node unreachable", zap.String("node", node.ID), zap.Error(err))
			continue
		}

		conn.Write(data)
		conn.Close()

		sm.cache.Put(chunkID, data, node.ID, time.Hour)
	}

	return nil
}
