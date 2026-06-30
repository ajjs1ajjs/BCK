package backup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"

	"go.uber.org/zap"
)

type P2PNode struct {
	ID        string   `json:"id"`
	Addresses []string `json:"addresses"`
	LastSeen  time.Time `json:"last_seen"`
	Storage   int64    `json:"storage_bytes"`
	Available int64    `json:"available_bytes"`
	Region    string   `json:"region"`
}

type P2PChunk struct {
	CID      string   `json:"cid"` // Content ID (IPFS-style CID)
	Data     []byte   `json:"data,omitempty"`
	Size     int64    `json:"size"`
	Peers    []string `json:"peers"`
	CreatedAt time.Time `json:"created_at"`
}

type P2PNetwork struct {
	nodeID       string
	nodes        map[string]*P2PNode
	chunks       map[string]*P2PChunk
	listener     net.Listener
	mu           sync.RWMutex
	logger       *zap.Logger
	replication  int // number of replicas per chunk
}

func NewP2PNetwork(nodeID string, port int, replication int, logger *zap.Logger) (*P2PNetwork, error) {
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}

	pn := &P2PNetwork{
		nodeID:      nodeID,
		nodes:       make(map[string]*P2PNode),
		chunks:      make(map[string]*P2PChunk),
		listener:    listener,
		logger:      logger,
		replication: replication,
	}

	go pn.acceptConnections()

	return pn, nil
}

func (pn *P2PNetwork) acceptConnections() {
	for {
		conn, err := pn.listener.Accept()
		if err != nil {
			return
		}
		go pn.handleConnection(conn)
	}
}

func (pn *P2PNetwork) handleConnection(conn net.Conn) {
	defer conn.Close()

	var msg p2pMessage
	decoder := json.NewDecoder(conn)
	if err := decoder.Decode(&msg); err != nil {
		return
	}

	switch msg.Type {
	case "announce":
		pn.handleAnnounce(msg)
	case "store_chunk":
		pn.handleStoreChunk(msg)
	case "get_chunk":
		pn.handleGetChunk(conn, msg)
	case "find_peers":
		pn.handleFindPeers(conn)
	}
}

type p2pMessage struct {
	Type    string          `json:"type"`
	From    string          `json:"from"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (pn *P2PNetwork) handleAnnounce(msg p2pMessage) {
	var node P2PNode
	if err := json.Unmarshal(msg.Data, &node); err != nil {
		return
	}

	node.LastSeen = time.Now()

	pn.mu.Lock()
	pn.nodes[node.ID] = &node
	pn.mu.Unlock()

	pn.logger.Info("P2P peer announced", zap.String("peer", node.ID), zap.Strings("addrs", node.Addresses))
}

func (pn *P2PNetwork) handleStoreChunk(msg p2pMessage) {
	var chunk P2PChunk
	if err := json.Unmarshal(msg.Data, &chunk); err != nil {
		return
	}

	chunk.Peers = append(chunk.Peers, pn.nodeID)

	pn.mu.Lock()
	pn.chunks[chunk.CID] = &chunk
	pn.mu.Unlock()

	pn.logger.Info("P2P chunk stored", zap.String("cid", chunk.CID[:16]+"..."), zap.Int64("size", chunk.Size))
}

func (pn *P2PNetwork) handleGetChunk(conn net.Conn, msg p2pMessage) {
	var req struct{ CID string }
	json.Unmarshal(msg.Data, &req)

	pn.mu.RLock()
	chunk, exists := pn.chunks[req.CID]
	pn.mu.RUnlock()

	resp := p2pMessage{Type: "chunk_response"}
	if exists {
		resp.Data, _ = json.Marshal(chunk)
	} else {
		resp.Type = "not_found"
	}

	json.NewEncoder(conn).Encode(resp)
}

func (pn *P2PNetwork) handleFindPeers(conn net.Conn) {
	pn.mu.RLock()
	defer pn.mu.RUnlock()

	peers := make([]string, 0, len(pn.nodes))
	for id := range pn.nodes {
		if id != pn.nodeID {
			peers = append(peers, id)
		}
	}

	resp := p2pMessage{Type: "peers_response"}
	resp.Data, _ = json.Marshal(peers)
	json.NewEncoder(conn).Encode(resp)
}

func (pn *P2PNetwork) Store(ctx context.Context, data []byte) (*P2PChunk, error) {
	hash := sha256.Sum256(data)
	multihash := hex.EncodeToString(hash[:])

	cid := fmt.Sprintf("bck-p2p-%s", multihash[:32])

	chunk := &P2PChunk{
		CID:       cid,
		Data:      data,
		Size:      int64(len(data)),
		Peers:     []string{pn.nodeID},
		CreatedAt: time.Now(),
	}

	// Store locally
	pn.mu.Lock()
	pn.chunks[cid] = chunk
	pn.mu.Unlock()

	// Replicate to other peers
	pn.replicateToPeers(ctx, chunk)

	pn.logger.Info("P2P content stored",
		zap.String("cid", cid[:20]+"..."),
		zap.Int64("size", chunk.Size),
		zap.Int("peers", len(chunk.Peers)),
	)

	return chunk, nil
}

func (pn *P2PNetwork) replicateToPeers(ctx context.Context, chunk *P2PChunk) {
	pn.mu.RLock()
	peers := make([]*P2PNode, 0)
	for _, node := range pn.nodes {
		if node.ID != pn.nodeID {
			peers = append(peers, node)
		}
	}
	pn.mu.RUnlock()

	replicated := 0
	for _, peer := range peers {
		if replicated >= pn.replication-1 {
			break
		}

		for _, addr := range peer.Addresses {
			conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
			if err != nil {
				continue
			}

			stripped := *chunk
			stripped.Data = chunk.Data // include data for transmission
			payload, _ := json.Marshal(stripped)

			msg := p2pMessage{
				Type: "store_chunk",
				From: pn.nodeID,
				Data: payload,
			}

			json.NewEncoder(conn).Encode(msg)
			conn.Close()
			replicated++
			break
		}
	}
}

func (pn *P2PNetwork) Retrieve(cid string) ([]byte, error) {
	pn.mu.RLock()
	chunk, exists := pn.chunks[cid]
	pn.mu.RUnlock()

	if exists && chunk.Data != nil {
		return chunk.Data, nil
	}

	// Try to find from peers
	return pn.retrieveFromPeers(cid)
}

func (pn *P2PNetwork) retrieveFromPeers(cid string) ([]byte, error) {
	pn.mu.RLock()
	nodes := make([]*P2PNode, 0, len(pn.nodes))
	for _, n := range pn.nodes {
		nodes = append(nodes, n)
	}
	pn.mu.RUnlock()

	for _, node := range nodes {
		for _, addr := range node.Addresses {
			conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
			if err != nil {
				continue
			}

			msg := p2pMessage{
				Type: "get_chunk",
				From: pn.nodeID,
				Data: json.RawMessage(fmt.Sprintf(`{"cid":"%s"}`, cid)),
			}

			json.NewEncoder(conn).Encode(msg)

			var resp p2pMessage
			json.NewDecoder(conn).Decode(&resp)
			conn.Close()

			if resp.Type == "chunk_response" {
				var chunk P2PChunk
				json.Unmarshal(resp.Data, &chunk)
				return chunk.Data, nil
			}
		}
	}

	return nil, fmt.Errorf("chunk not found: %s", cid)
}

func (pn *P2PNetwork) Connect(peerID string, addresses []string) {
	pn.mu.Lock()
	pn.nodes[peerID] = &P2PNode{
		ID:        peerID,
		Addresses: addresses,
		LastSeen:  time.Now(),
	}
	pn.mu.Unlock()

	pn.logger.Info("P2P peer connected", zap.String("peer", peerID))
}

func (pn *P2PNetwork) Stats() map[string]interface{} {
	pn.mu.RLock()
	defer pn.mu.RUnlock()

	var totalSize int64
	for _, c := range pn.chunks {
		totalSize += c.Size
	}

	return map[string]interface{}{
		"node_id":     pn.nodeID,
		"peers":       len(pn.nodes),
		"chunks":      len(pn.chunks),
		"total_size":  totalSize,
		"replication": pn.replication,
	}
}

func (pn *P2PNetwork) Close() error {
	return pn.listener.Close()
}
