package backup

import (
	"fmt"
	"strings"

	"go.uber.org/zap"
)

type ParsedIntent struct {
	Action     string            `json:"action"`     // backup, restore, schedule, configure
	Target     string            `json:"target"`     // what to backup
	Frequency  string            `json:"frequency"`  // daily, hourly, weekly, etc.
	Retention  int               `json:"retention"`  // days to keep
	Repository string            `json:"repository"`
	Priority   string            `json:"priority"`   // high, normal, low
	Encryption bool              `json:"encryption"`
	Compress   bool              `json:"compress"`
	Params     map[string]string `json:"params,omitempty"`
	Confidence float64           `json:"confidence"` // 0-1
	RawIntent  string            `json:"raw_intent"`
}

type IntentEngine struct {
	logger    *zap.Logger
	templates map[string]string
}

func NewIntentEngine(logger *zap.Logger) *IntentEngine {
	ie := &IntentEngine{
		logger:    logger,
		templates: make(map[string]string),
	}
	ie.registerTemplates()
	return ie
}

func (ie *IntentEngine) registerTemplates() {
	ie.templates["postgresql backup"] = `kind: BackupPlan
spec:
  source: postgresql://${host}/${database}
  schedule: "0 0 ${hour} * * *"
  retention: { daily: ${days} }`

	ie.templates["mysql backup"] = `kind: BackupPlan
spec:
  source: mysql://${host}/${database}
  schedule: "0 0 ${hour} * * *"
  retention: { daily: ${days} }`

	ie.templates["filesystem backup"] = `kind: BackupPlan
spec:
  source: ${path}
  schedule: "0 0 ${hour} * * *"
  retention: { daily: ${days} }`

	ie.templates["docker backup"] = `kind: BackupPlan
spec:
  source: docker://${container}
  schedule: "0 0 ${hour} * * *"`

	ie.templates["kubernetes backup"] = `kind: BackupPlan
spec:
  source: k8s://${namespace}
  schedule: "0 0 ${hour} * * *"
  retention: { daily: ${days} }`
}

func (ie *IntentEngine) Parse(intent string) (*ParsedIntent, error) {
	lower := strings.ToLower(intent)

	result := &ParsedIntent{
		RawIntent:  intent,
		Confidence: 0.5,
		Encryption: true,
		Compress:   true,
	}

	// Detect action
	actions := map[string]string{
		"backup":    "backup",
		"restore":   "restore",
		"schedule":  "schedule",
		"configure": "configure",
		"back up":   "backup",
		"set up":    "configure",
	}
	for keyword, action := range actions {
		if strings.Contains(lower, keyword) {
			result.Action = action
			result.Confidence += 0.1
			break
		}
	}
	if result.Action == "" {
		result.Action = "backup"
	}

	// Detect target
	targets := map[string]string{
		"postgres":   "postgresql",
		"postgresql": "postgresql",
		"mysql":      "mysql",
		"mariadb":    "mysql",
		"database":   "postgresql",
		"db":         "postgresql",
		"files":      "filesystem",
		"directory":  "filesystem",
		"folder":     "filesystem",
		"docker":     "docker",
		"kubernetes": "kubernetes",
		"k8s":        "kubernetes",
		"everything": "filesystem",
		"all":        "filesystem",
	}
	for keyword, target := range targets {
		if strings.Contains(lower, keyword) {
			result.Target = target
			result.Confidence += 0.15
			break
		}
	}

	// Detect frequency
	frequencies := map[string]string{
		"every hour": "hourly",
		"hourly":     "hourly",
		"every day":  "daily",
		"daily":      "daily",
		"every night":"daily",
		"every week": "weekly",
		"weekly":     "weekly",
		"every month":"monthly",
		"monthly":    "monthly",
	}
	for keyword, freq := range frequencies {
		if strings.Contains(lower, keyword) {
			result.Frequency = freq
			result.Confidence += 0.1
			break
		}
	}
	if result.Frequency == "" {
		result.Frequency = "daily"
	}

	// Detect retention
	afterIdx := strings.LastIndex(lower, "for")
	if afterIdx > 0 {
		rest := lower[afterIdx+3:]
		for _, word := range strings.Fields(rest) {
			var days int
			if _, err := fmt.Sscanf(word, "%d", &days); err == nil {
				if strings.Contains(rest, "day") {
					result.Retention = days
				} else if strings.Contains(rest, "week") {
					result.Retention = days * 7
				} else if strings.Contains(rest, "month") {
					result.Retention = days * 30
				}
				result.Confidence += 0.1
				break
			}
		}
	}
	if result.Retention == 0 {
		result.Retention = 7 // default
	}

	// Detect priority
	if strings.Contains(lower, "critical") || strings.Contains(lower, "urgent") || strings.Contains(lower, "important") {
		result.Priority = "high"
		result.Confidence += 0.05
	} else {
		result.Priority = "normal"
	}

	// Detect encryption preference
	if strings.Contains(lower, "no encrypt") || strings.Contains(lower, "without encryption") || strings.Contains(lower, "plain") {
		result.Encryption = false
	}

	// Extract params
	result.Params = make(map[string]string)
	extractParam(lower, "host", result.Params)
	extractParam(lower, "database", result.Params)
	extractParam(lower, "repo", result.Params)

	if result.Confidence > 1.0 {
		result.Confidence = 1.0
	}

	ie.logger.Info("intent parsed",
		zap.String("intent", intent),
		zap.String("action", result.Action),
		zap.String("target", result.Target),
		zap.Float64("confidence", result.Confidence),
	)

	return result, nil
}

func extractParam(text, param string, params map[string]string) {
	idx := strings.Index(strings.ToLower(text), param+" ")
	if idx < 0 {
		idx = strings.Index(strings.ToLower(text), param+":")
	}
	if idx < 0 {
		return
	}

	rest := text[idx+len(param)+1:]
	words := strings.Fields(rest)
	if len(words) > 0 {
		val := strings.TrimRight(words[0], ",.;:")
		params[param] = val
	}
}

func (ie *IntentEngine) GenerateManifest(intent *ParsedIntent) (string, error) {
	templateKey := intent.Target + " backup"
	template, exists := ie.templates[templateKey]
	if !exists {
		template = ie.templates["filesystem backup"]
	}

	manifest := fmt.Sprintf(`apiVersion: v1
kind: BackupPlan
metadata:
  name: intent-%s
  labels: { intent-generated: "true" }
%s`, intent.Target, template)

	manifest = strings.ReplaceAll(manifest, "${days}", fmt.Sprintf("%d", intent.Retention))
	manifest = strings.ReplaceAll(manifest, "${hour}", "2")

	if host, ok := intent.Params["host"]; ok {
		manifest = strings.ReplaceAll(manifest, "${host}", host)
	}
	if db, ok := intent.Params["database"]; ok {
		manifest = strings.ReplaceAll(manifest, "${database}", db)
	}

	ie.logger.Info("intent manifest generated", zap.Float64("confidence", intent.Confidence))
	return manifest, nil
}

func (ie *IntentEngine) Process(intent string) (*ParsedIntent, string, error) {
	parsed, err := ie.Parse(intent)
	if err != nil {
		return nil, "", fmt.Errorf("parse intent: %w", err)
	}

	manifest, err := ie.GenerateManifest(parsed)
	if err != nil {
		return nil, "", fmt.Errorf("generate manifest: %w", err)
	}

	return parsed, manifest, nil
}
