package migrations

import (
	"context"
	"embed"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed *.sql
var migrationsFS embed.FS

func Run(dsn string, direction string) error {
	db, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer db.Close()

	sqlDB := stdlib.OpenDB(*db.Config().ConnConfig)

	driver, err := postgres.WithInstance(sqlDB, &postgres.Config{})
	if err != nil {
		return fmt.Errorf("create driver: %w", err)
	}

	source, err := iofs.New(migrationsFS, ".")
	if err != nil {
		return fmt.Errorf("create source: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", source, "postgres", driver)
	if err != nil {
		return fmt.Errorf("create migrate: %w", err)
	}

	switch direction {
	case "up":
		err = m.Up()
	case "down":
		err = m.Down()
	default:
		return fmt.Errorf("unknown direction: %s (use 'up' or 'down')", direction)
	}

	if err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migrate: %w", err)
	}

	fmt.Println("Migrations applied successfully")
	return nil
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: migrate <up|down>\n")
		os.Exit(1)
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://backup:backup@localhost:5432/backupmanager?sslmode=disable"
	}

	if err := Run(dsn, os.Args[1]); err != nil {
		fmt.Fprintf(os.Stderr, "migration failed: %v\n", err)
		os.Exit(1)
	}
}
