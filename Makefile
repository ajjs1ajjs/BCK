.PHONY: build run-api run-worker run-scheduler run-agent test lint migrate proto docker-up docker-down clean

# Build all binaries
build:
	go build -o bin/backup-api ./cmd/backup-api
	go build -o bin/backup-worker ./cmd/backup-worker
	go build -o bin/backup-scheduler ./cmd/backup-scheduler
	go build -o bin/backup-agent ./cmd/backup-agent
	go build -o bin/backup-cli ./cmd/backup-cli

run-cli:
	go run ./cmd/backup-cli $(ARGS)

run-api:
	go run ./cmd/backup-api

run-worker:
	go run ./cmd/backup-worker

run-scheduler:
	go run ./cmd/backup-scheduler

run-agent:
	go run ./cmd/backup-agent

test:
	go test ./... -v -count=1

test-integration:
	go test ./... -tags=integration -v -count=1

lint:
	golangci-lint run ./...

migrate-up:
	go run ./internal/store/migrations/migrate.go up

migrate-down:
	go run ./internal/store/migrations/migrate.go down

proto:
	protoc --go_out=. --go-grpc_out=. proto/agent/agent.proto

docker-up:
	docker compose -f deployments/docker-compose.yml build --no-cache backup-ui 2>/dev/null || true
	docker compose -f deployments/docker-compose.yml up -d

docker-down:
	docker compose -f deployments/docker-compose.yml down

clean:
	rm -rf bin/
