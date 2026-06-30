package store

import (
	"context"
	"fmt"

	"github.com/ajjs1ajjs/BCK/internal/models"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lib/pq"
)

type AgentStore struct {
	db *pgxpool.Pool
}

func NewAgentStore(db *pgxpool.Pool) *AgentStore {
	return &AgentStore{db: db}
}

func (s *AgentStore) Register(ctx context.Context, req *models.RegisterAgentRequest) (*models.Agent, error) {
	var agent models.Agent
	err := s.db.QueryRow(ctx,
		`INSERT INTO agents (name, address, port, version, labels)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (address, port) DO UPDATE SET
			name = EXCLUDED.name,
			version = EXCLUDED.version,
			status = 'online',
			last_seen_at = NOW(),
			labels = EXCLUDED.labels
		 RETURNING id, name, hostname, address, port, version, status, last_seen_at, registered_at, labels`,
		req.Name, req.Address, req.Port, req.Version, pq.Array(req.Labels),
	).Scan(
		&agent.ID, &agent.Name, &agent.Hostname,
		&agent.Address, &agent.Port, &agent.Version,
		&agent.Status, &agent.LastSeenAt, &agent.RegisteredAt,
		(*pq.StringArray)(&agent.Labels),
	)
	if err != nil {
		return nil, fmt.Errorf("register agent: %w", err)
	}
	return &agent, nil
}

func (s *AgentStore) List(ctx context.Context) ([]models.Agent, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, name, hostname, address, port, version, status, last_seen_at, registered_at, labels
		 FROM agents ORDER BY registered_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list agents: %w", err)
	}
	defer rows.Close()

	var agents []models.Agent
	for rows.Next() {
		var a models.Agent
		err := rows.Scan(
			&a.ID, &a.Name, &a.Hostname,
			&a.Address, &a.Port, &a.Version,
			&a.Status, &a.LastSeenAt, &a.RegisteredAt,
			(*pq.StringArray)(&a.Labels),
		)
		if err != nil {
			continue
		}
		agents = append(agents, a)
	}
	return agents, nil
}

func (s *AgentStore) Get(ctx context.Context, id string) (*models.Agent, error) {
	var a models.Agent
	err := s.db.QueryRow(ctx,
		`SELECT id, name, hostname, address, port, version, status, last_seen_at, registered_at, labels
		 FROM agents WHERE id = $1`, id,
	).Scan(
		&a.ID, &a.Name, &a.Hostname,
		&a.Address, &a.Port, &a.Version,
		&a.Status, &a.LastSeenAt, &a.RegisteredAt,
		(*pq.StringArray)(&a.Labels),
	)
	if err != nil {
		return nil, fmt.Errorf("get agent: %w", err)
	}
	return &a, nil
}

func (s *AgentStore) UpdateStatus(ctx context.Context, id string, status string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE agents SET status = $2, last_seen_at = NOW() WHERE id = $1`,
		id, status,
	)
	return err
}

func (s *AgentStore) Delete(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM agents WHERE id = $1`, id)
	return err
}

func (s *AgentStore) Heartbeat(ctx context.Context, id string, hostname, version string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE agents SET status = 'online', last_seen_at = NOW(), hostname = $2, version = $3 WHERE id = $1`,
		id, hostname, version,
	)
	return err
}
