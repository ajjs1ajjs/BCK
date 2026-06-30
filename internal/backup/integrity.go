package backup

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"go.uber.org/zap"
)

type MerkleNode struct {
	Hash     string       `json:"hash"`
	Left     *MerkleNode  `json:"left,omitempty"`
	Right    *MerkleNode  `json:"right,omitempty"`
	Data     []byte       `json:"data,omitempty"`
}

type MerkleTree struct {
	Root      *MerkleNode  `json:"root"`
	Leaves    []*MerkleNode `json:"leaves"`
	LeafCount int          `json:"leaf_count"`
	CreatedAt time.Time    `json:"created_at"`
}

type ProofElement struct {
	Hash      string `json:"hash"`
	Direction string `json:"direction"` // left, right
}

type MerkleProof struct {
	LeafHash string         `json:"leaf_hash"`
	Path     []ProofElement `json:"path"`
	RootHash string         `json:"root_hash"`
}

type IntegrityManager struct {
	trees  map[string]*MerkleTree
	logger *zap.Logger
}

func NewIntegrityManager(logger *zap.Logger) *IntegrityManager {
	return &IntegrityManager{
		trees:  make(map[string]*MerkleTree),
		logger: logger,
	}
}

func NewMerkleTree(data [][]byte) *MerkleTree {
	n := len(data)
	if n == 0 {
		return &MerkleTree{CreatedAt: time.Now()}
	}

	leaves := make([]*MerkleNode, n)
	for i, d := range data {
		h := sha256.Sum256(d)
		leaves[i] = &MerkleNode{
			Hash: hex.EncodeToString(h[:]),
			Data: d,
		}
	}

	root := buildMerkleTree(leaves)

	return &MerkleTree{
		Root:      root,
		Leaves:    leaves,
		LeafCount: n,
		CreatedAt: time.Now(),
	}
}

func buildMerkleTree(nodes []*MerkleNode) *MerkleNode {
	if len(nodes) == 0 {
		return nil
	}
	if len(nodes) == 1 {
		return nodes[0]
	}

	var parents []*MerkleNode
	for i := 0; i < len(nodes); i += 2 {
		left := nodes[i]
		var right *MerkleNode
		if i+1 < len(nodes) {
			right = nodes[i+1]
		} else {
			right = left
		}

		combined := left.Hash + right.Hash
		h := sha256.Sum256([]byte(combined))

		parents = append(parents, &MerkleNode{
			Hash:  hex.EncodeToString(h[:]),
			Left:  left,
			Right: right,
		})
	}

	return buildMerkleTree(parents)
}

func (mt *MerkleTree) GenerateProof(leafIndex int) (*MerkleProof, error) {
	if leafIndex < 0 || leafIndex >= mt.LeafCount {
		return nil, fmt.Errorf("leaf index %d out of range", leafIndex)
	}

	proof := &MerkleProof{
		LeafHash: mt.Leaves[leafIndex].Hash,
		RootHash: mt.Root.Hash,
		Path:     make([]ProofElement, 0),
	}

	nodes := mt.Leaves
	idx := leafIndex

	for len(nodes) > 1 {
		isLeft := idx%2 == 0
		siblingIdx := idx + 1
		if !isLeft {
			siblingIdx = idx - 1
		}

		var siblingHash string
		var direction string
		if siblingIdx < len(nodes) {
			siblingHash = nodes[siblingIdx].Hash
			if isLeft {
				direction = "right"
			} else {
				direction = "left"
			}
		} else {
			siblingHash = nodes[idx].Hash
			direction = "self"
		}

		proof.Path = append(proof.Path, ProofElement{
			Hash:      siblingHash,
			Direction: direction,
		})

		nodes = parentNodes(nodes)
		idx = idx / 2
	}

	return proof, nil
}

func parentNodes(nodes []*MerkleNode) []*MerkleNode {
	var parents []*MerkleNode
	for i := 0; i < len(nodes); i += 2 {
		left := nodes[i]
		right := left
		if i+1 < len(nodes) {
			right = nodes[i+1]
		}

		combined := left.Hash + right.Hash
		h := sha256.Sum256([]byte(combined))

		parents = append(parents, &MerkleNode{
			Hash:  hex.EncodeToString(h[:]),
			Left:  left,
			Right: right,
		})
	}
	return parents
}

func VerifyProof(proof *MerkleProof, leafData []byte) bool {
	h := sha256.Sum256(leafData)
	currentHash := hex.EncodeToString(h[:])

	if currentHash != proof.LeafHash {
		return false
	}

	for _, elem := range proof.Path {
		switch elem.Direction {
		case "left":
			currentHash = hashPair(elem.Hash, currentHash)
		case "right":
			currentHash = hashPair(currentHash, elem.Hash)
		case "self":
			currentHash = hashPair(currentHash, currentHash)
		}
	}

	return currentHash == proof.RootHash
}

func hashPair(a, b string) string {
	h := sha256.Sum256([]byte(a + b))
	return hex.EncodeToString(h[:])
}

func (im *IntegrityManager) BuildForSnapshot(snapshotID string, chunks map[string]*ChunkInfo) (*MerkleTree, error) {
	var data [][]byte
	for _, chunk := range chunks {
		data = append(data, []byte(chunk.Hash))
	}

	tree := NewMerkleTree(data)
	im.trees[snapshotID] = tree

	im.logger.Info("merkle tree built",
		zap.String("snapshot", snapshotID),
		zap.Int("leaves", tree.LeafCount),
		zap.String("root", tree.Root.Hash),
	)

	return tree, nil
}

func (im *IntegrityManager) VerifyChunk(snapshotID string, chunkIndex int, chunkData []byte) (bool, error) {
	tree, exists := im.trees[snapshotID]
	if !exists {
		return false, fmt.Errorf("no merkle tree for snapshot %s", snapshotID)
	}

	proof, err := tree.GenerateProof(chunkIndex)
	if err != nil {
		return false, err
	}

	return VerifyProof(proof, chunkData), nil
}

func (im *IntegrityManager) ExportProof(snapshotID string, chunkIndex int, outputPath string) error {
	tree, exists := im.trees[snapshotID]
	if !exists {
		return fmt.Errorf("no tree for snapshot %s", snapshotID)
	}

	proof, err := tree.GenerateProof(chunkIndex)
	if err != nil {
		return err
	}

	data, _ := json.MarshalIndent(proof, "", "  ")
	return os.WriteFile(outputPath, data, 0600)
}

type AuditChainEntry struct {
	Timestamp   time.Time `json:"timestamp"`
	Action      string    `json:"action"`
	SnapshotID  string    `json:"snapshot_id"`
	MerkleRoot  string    `json:"merkle_root"`
	PreviousHash string   `json:"previous_hash"`
	Hash        string    `json:"hash"`
	Signature   string    `json:"signature,omitempty"`
}

type BlockchainAudit struct {
	Chain    []AuditChainEntry `json:"chain"`
	logger   *zap.Logger
}

func NewBlockchainAudit(logger *zap.Logger) *BlockchainAudit {
	return &BlockchainAudit{
		Chain:  make([]AuditChainEntry, 0),
		logger: logger,
	}
}

func (ba *BlockchainAudit) AppendEntry(action, snapshotID, merkleRoot string) *AuditChainEntry {
	var prevHash string
	if len(ba.Chain) > 0 {
		prevHash = ba.Chain[len(ba.Chain)-1].Hash
	}

	entry := AuditChainEntry{
		Timestamp:    time.Now(),
		Action:       action,
		SnapshotID:   snapshotID,
		MerkleRoot:   merkleRoot,
		PreviousHash: prevHash,
	}

	// Compute hash linking this entry to previous
	data := fmt.Sprintf("%d|%s|%s|%s|%s",
		entry.Timestamp.UnixNano(),
		entry.Action,
		entry.SnapshotID,
		entry.MerkleRoot,
		entry.PreviousHash,
	)
	h := sha256.Sum256([]byte(data))
	entry.Hash = hex.EncodeToString(h[:])

	ba.Chain = append(ba.Chain, entry)

	ba.logger.Info("audit chain entry added",
		zap.String("action", action),
		zap.String("root", merkleRoot[:16]+"..."),
	)

	return &entry
}

func (ba *BlockchainAudit) VerifyChain() bool {
	for i := 1; i < len(ba.Chain); i++ {
		if ba.Chain[i].PreviousHash != ba.Chain[i-1].Hash {
			return false
		}
	}
	return true
}
