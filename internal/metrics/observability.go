package metrics

import (
	"context"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

type TraceSpan struct {
	Name       string            `json:"name"`
	TraceID    string            `json:"trace_id"`
	SpanID     string            `json:"span_id"`
	ParentID   string            `json:"parent_id,omitempty"`
	StartTime  time.Time         `json:"start_time"`
	EndTime    time.Time         `json:"end_time,omitempty"`
	Duration   float64           `json:"duration_ms"`
	Status     string            `json:"status"`
	Attributes map[string]string `json:"attributes,omitempty"`
	Events     []TraceEvent      `json:"events,omitempty"`
}

type TraceEvent struct {
	Name       string    `json:"name"`
	Timestamp  time.Time `json:"timestamp"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

type TracerManager struct {
	tracer   trace.Tracer
	provider *sdktrace.TracerProvider
	spans    map[string]*TraceSpan
	mu       sync.RWMutex
	logger   *zap.Logger
}

func NewTracerManager(logger *zap.Logger) (*TracerManager, error) {
	tm := &TracerManager{
		spans: make(map[string]*TraceSpan),
		logger: logger,
	}

	tp, err := initTracer()
	if err != nil {
		logger.Warn("failed to init OTel tracer, using noop", zap.Error(err))
		tp = sdktrace.NewTracerProvider()
	}

	tm.provider = tp
	tm.tracer = tp.Tracer("bck-backup-manager")

	return tm, nil
}

func initTracer() (*sdktrace.TracerProvider, error) {
	exporter, err := stdouttrace.New(stdouttrace.WithPrettyPrint())
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName("bck-backup-manager"),
			semconv.ServiceVersion("7.0.0"),
		)),
	)

	otel.SetTracerProvider(tp)
	return tp, nil
}

func (tm *TracerManager) StartSpan(ctx context.Context, name string, attrs map[string]string) (context.Context, *TraceSpan) {
	opts := []trace.SpanStartOption{}

	for k, v := range attrs {
		opts = append(opts, trace.WithAttributes(attribute.String(k, v)))
	}

	ctx, span := tm.tracer.Start(ctx, name, opts...)

	ts := &TraceSpan{
		Name:       name,
		TraceID:    span.SpanContext().TraceID().String(),
		SpanID:     span.SpanContext().SpanID().String(),
		StartTime:  time.Now(),
		Status:     "running",
		Attributes: attrs,
	}

	tm.mu.Lock()
	tm.spans[ts.SpanID] = ts
	tm.mu.Unlock()

	return ctx, ts
}

func (tm *TracerManager) EndSpan(ts *TraceSpan) {
	ts.EndTime = time.Now()
	ts.Duration = float64(ts.EndTime.Sub(ts.StartTime).Milliseconds())
	ts.Status = "completed"

	tm.mu.Lock()
	tm.spans[ts.SpanID] = ts
	tm.mu.Unlock()
}

func (tm *TracerManager) Shutdown(ctx context.Context) error {
	return tm.provider.Shutdown(ctx)
}

type LogEntry struct {
	Timestamp   time.Time              `json:"timestamp"`
	Level       string                 `json:"level"`
	Service     string                 `json:"service"`
	Message     string                 `json:"message"`
	TraceID     string                 `json:"trace_id,omitempty"`
	SpanID      string                 `json:"span_id,omitempty"`
	Fields      map[string]interface{} `json:"fields,omitempty"`
	Duration    float64                `json:"duration_ms,omitempty"`
}

type LogAggregator struct {
	entries    []LogEntry
	mu         sync.RWMutex
	maxEntries int
	buffer     chan LogEntry
}

func NewLogAggregator(maxEntries int) *LogAggregator {
	la := &LogAggregator{
		maxEntries: maxEntries,
		buffer:     make(chan LogEntry, 10000),
	}
	go la.process()
	return la
}

func (la *LogAggregator) process() {
	for entry := range la.buffer {
		la.mu.Lock()
		la.entries = append(la.entries, entry)
		if len(la.entries) > la.maxEntries {
			la.entries = la.entries[len(la.entries)-la.maxEntries:]
		}
		la.mu.Unlock()
	}
}

func (la *LogAggregator) Append(entry LogEntry) {
	select {
	case la.buffer <- entry:
	default:
	}
}

func (la *LogAggregator) Query(service, level string, limit int) []LogEntry {
	la.mu.RLock()
	defer la.mu.RUnlock()

	var result []LogEntry
	for i := len(la.entries) - 1; i >= 0 && len(result) < limit; i-- {
		e := la.entries[i]
		if service != "" && e.Service != service {
			continue
		}
		if level != "" && e.Level != level {
			continue
		}
		result = append(result, e)
	}
	return result
}

func (la *LogAggregator) Count() int {
	la.mu.RLock()
	defer la.mu.RUnlock()
	return len(la.entries)
}

type APMMetrics struct {
	RequestsPerMinute float64           `json:"requests_per_minute"`
	ErrorRate         float64           `json:"error_rate"`
	P50Latency        float64           `json:"p50_latency_ms"`
	P95Latency        float64           `json:"p95_latency_ms"`
	P99Latency        float64           `json:"p99_latency_ms"`
	ActiveConnections int              `json:"active_connections"`
	ThroughputMBps    float64           `json:"throughput_mbps"`
}

type APMCollector struct {
	latencies     []float64
	errors        int64
	total         int64
	mu            sync.RWMutex
	windowStart   time.Time
}

func NewAPMCollector() *APMCollector {
	return &APMCollector{windowStart: time.Now()}
}

func (ac *APMCollector) RecordRequest(latency time.Duration, isError bool) {
	ac.mu.Lock()
	defer ac.mu.Unlock()

	ac.latencies = append(ac.latencies, float64(latency.Milliseconds()))
	ac.total++
	if isError {
		ac.errors++
	}
}

func (ac *APMCollector) Snapshot() *APMMetrics {
	ac.mu.Lock()
	defer ac.mu.Unlock()

	minutes := time.Since(ac.windowStart).Minutes()
	if minutes == 0 {
		minutes = 1
	}

	rpm := float64(ac.total) / minutes

	var errRate float64
	if ac.total > 0 {
		errRate = float64(ac.errors) / float64(ac.total) * 100
	}

	p50, p95, p99 := calculatePercentiles(ac.latencies)

	// Reset window
	ac.latencies = nil
	ac.errors = 0
	ac.total = 0
	ac.windowStart = time.Now()

	return &APMMetrics{
		RequestsPerMinute: rpm,
		ErrorRate:         errRate,
		P50Latency:        p50,
		P95Latency:        p95,
		P99Latency:        p99,
	}
}

func calculatePercentiles(latencies []float64) (p50, p95, p99 float64) {
	if len(latencies) == 0 {
		return 0, 0, 0
	}

	sorted := make([]float64, len(latencies))
	copy(sorted, latencies)

	for i := 1; i < len(sorted); i++ {
		key := sorted[i]
		j := i - 1
		for j >= 0 && sorted[j] > key {
			sorted[j+1] = sorted[j]
			j--
		}
		sorted[j+1] = key
	}

	idx := func(pct float64) int {
		i := int(float64(len(sorted)) * pct)
		if i >= len(sorted) {
			i = len(sorted) - 1
		}
		return i
	}

	p50 = sorted[idx(0.50)]
	p95 = sorted[idx(0.95)]
	p99 = sorted[idx(0.99)]
	return
}
