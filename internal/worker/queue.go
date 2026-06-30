package worker

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Queue struct {
	client *redis.Client
	name   string
}

func NewQueue(client *redis.Client, name string) *Queue {
	return &Queue{
		client: client,
		name:   name,
	}
}

func (q *Queue) Enqueue(ctx context.Context, item string) error {
	return q.client.LPush(ctx, q.name, item).Err()
}

func (q *Queue) EnqueueWithPriority(ctx context.Context, item string) error {
	return q.client.RPush(ctx, q.name, item).Err()
}

func (q *Queue) Dequeue(ctx context.Context, timeout time.Duration) (string, error) {
	result, err := q.client.BRPop(ctx, timeout, q.name).Result()
	if err != nil {
		return "", err
	}
	if len(result) < 2 {
		return "", fmt.Errorf("invalid result length")
	}
	return result[1], nil
}

func (q *Queue) Length(ctx context.Context) (int64, error) {
	return q.client.LLen(ctx, q.name).Result()
}

func (q *Queue) Peek(ctx context.Context, index int64) (string, error) {
	return q.client.LIndex(ctx, q.name, index).Result()
}

func (q *Queue) Clear(ctx context.Context) error {
	return q.client.Del(ctx, q.name).Err()
}

func (q *Queue) Name() string {
	return q.name
}
