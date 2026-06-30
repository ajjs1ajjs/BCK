package store

import (
	"context"
	"fmt"

	"github.com/ajjs1ajjs/BCK/internal/models"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TenantStore struct {
	db *pgxpool.Pool
}

func NewTenantStore(db *pgxpool.Pool) *TenantStore {
	return &TenantStore{db: db}
}

func (s *TenantStore) CreateOrg(ctx context.Context, name, slug, ownerID string) (*models.Organization, error) {
	var org models.Organization
	err := s.db.QueryRow(ctx,
		`INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $2, $3)
		 RETURNING id, name, slug, owner_id, created_at`,
		name, slug, ownerID,
	).Scan(&org.ID, &org.Name, &org.Slug, &org.OwnerID, &org.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("create org: %w", err)
	}
	return &org, nil
}

func (s *TenantStore) GetOrg(ctx context.Context, id string) (*models.Organization, error) {
	var org models.Organization
	err := s.db.QueryRow(ctx,
		`SELECT id, name, slug, owner_id, created_at FROM organizations WHERE id = $1`, id,
	).Scan(&org.ID, &org.Name, &org.Slug, &org.OwnerID, &org.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get org: %w", err)
	}
	return &org, nil
}

func (s *TenantStore) ListOrgs(ctx context.Context, userID string) ([]models.Organization, error) {
	rows, err := s.db.Query(ctx,
		`SELECT o.id, o.name, o.slug, o.owner_id, o.created_at
		 FROM organizations o
		 JOIN team_members tm ON tm.organization_id = o.id
		 WHERE tm.user_id = $1
		 ORDER BY o.created_at DESC`, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list orgs: %w", err)
	}
	defer rows.Close()

	var orgs []models.Organization
	for rows.Next() {
		var o models.Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.OwnerID, &o.CreatedAt); err != nil {
			continue
		}
		orgs = append(orgs, o)
	}
	return orgs, nil
}

func (s *TenantStore) DeleteOrg(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, id)
	return err
}

func (s *TenantStore) CreateTeam(ctx context.Context, orgID, name string) (*models.Team, error) {
	var team models.Team
	err := s.db.QueryRow(ctx,
		`INSERT INTO teams (organization_id, name) VALUES ($1, $2)
		 RETURNING id, organization_id, name, created_at`,
		orgID, name,
	).Scan(&team.ID, &team.OrganizationID, &team.Name, &team.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("create team: %w", err)
	}
	return &team, nil
}

func (s *TenantStore) ListTeams(ctx context.Context, orgID string) ([]models.Team, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, organization_id, name, created_at FROM teams WHERE organization_id = $1`, orgID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var teams []models.Team
	for rows.Next() {
		var t models.Team
		if err := rows.Scan(&t.ID, &t.OrganizationID, &t.Name, &t.CreatedAt); err != nil {
			continue
		}
		teams = append(teams, t)
	}
	return teams, nil
}

func (s *TenantStore) AddMember(ctx context.Context, orgID, userID, role string) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO team_members (organization_id, user_id, role) VALUES ($1, $2, $3)
		 ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
		orgID, userID, role,
	)
	return err
}

func (s *TenantStore) RemoveMember(ctx context.Context, orgID, userID string) error {
	_, err := s.db.Exec(ctx,
		`DELETE FROM team_members WHERE organization_id = $1 AND user_id = $2`,
		orgID, userID,
	)
	return err
}

func (s *TenantStore) IsMember(ctx context.Context, orgID, userID string) (bool, error) {
	var count int
	err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM team_members WHERE organization_id = $1 AND user_id = $2`,
		orgID, userID,
	).Scan(&count)
	return count > 0, err
}
