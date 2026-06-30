package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

const defaultAPIURL = "http://localhost:8080/api/v1"

var apiURL string
var accessToken string

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	apiURL = os.Getenv("BCK_API_URL")
	if apiURL == "" {
		apiURL = defaultAPIURL
	}

	accessToken = os.Getenv("BCK_TOKEN")

	command := os.Args[1]
	args := os.Args[2:]

	switch command {
	case "login":
		cmdLogin(args)
	case "jobs":
		cmdJobs(args)
	case "repos":
		cmdRepos(args)
	case "agents":
		cmdAgents(args)
	case "snapshots":
		cmdSnapshots(args)
	case "restore":
		cmdRestore(args)
	case "stats":
		cmdStats()
	case "health":
		cmdHealth()
	case "run":
		cmdRun(args)
	case "help":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", command)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println(`BCK CLI - Backup Manager CLI

Usage:
  bck-cli <command> [args]

Commands:
  login <username> <password>    Login and get token
  jobs list                       List backup jobs
  jobs get <id>                   Get job details
  jobs create <name> <source> <repo-id>  Create new backup job
  jobs delete <id>                Delete backup job
  jobs runs <id>                  List job runs
  repos list                      List repositories
  repos create <name>             Create repository
  repos delete <id>               Delete repository
  agents list                     List registered agents
  agents register <name> <addr> <port>  Register new agent
  snapshots list                  List snapshots
  restore start <snapshot-id> <target>  Start restore
  run <job-id>                    Trigger job execution
  stats                           Show dashboard stats
  health                          Health check

Environment:
  BCK_API_URL    API server URL (default: http://localhost:8080/api/v1)
  BCK_TOKEN      JWT access token
`)
}

func apiGet(path string) (*http.Response, error) {
	req, _ := http.NewRequest("GET", apiURL+path, nil)
	if accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+accessToken)
	}
	return http.DefaultClient.Do(req)
}

func apiPost(path string, body io.Reader) (*http.Response, error) {
	req, _ := http.NewRequest("POST", apiURL+path, body)
	req.Header.Set("Content-Type", "application/json")
	if accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+accessToken)
	}
	return http.DefaultClient.Do(req)
}

func apiDelete(path string) (*http.Response, error) {
	req, _ := http.NewRequest("DELETE", apiURL+path, nil)
	if accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+accessToken)
	}
	return http.DefaultClient.Do(req)
}

func printJSON(resp *http.Response) {
	defer resp.Body.Close()
	var data interface{}
	json.NewDecoder(resp.Body).Decode(&data)
	out, _ := json.MarshalIndent(data, "", "  ")
	fmt.Println(string(out))
}

func cmdLogin(args []string) {
	if len(args) < 2 {
		fmt.Println("Usage: bck-cli login <username> <password>")
		os.Exit(1)
	}

	body := fmt.Sprintf(`{"username":"%s","password":"%s"}`, args[0], args[1])
	resp, err := apiPost("/auth/login", strings.NewReader(body))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	resp.Body.Close()

	if token, ok := result["access_token"].(string); ok {
		accessToken = token
		fmt.Printf("Login successful. Token: %s...\n", token[:20])
		fmt.Printf("Export: export BCK_TOKEN=%s\n", token)
	} else {
		printJSON(resp)
	}
}

func cmdJobs(args []string) {
	if len(args) < 1 {
		fmt.Println("Usage: bck-cli jobs <list|get|create|delete|runs>")
		os.Exit(1)
	}

	switch args[0] {
	case "list":
		resp, err := apiGet("/jobs")
		if err != nil { fmt.Fprintf(os.Stderr, "Error: %v\n", err); os.Exit(1) }
		printJSON(resp)

	case "get":
		if len(args) < 2 { fmt.Println("Usage: bck-cli jobs get <id>"); os.Exit(1) }
		resp, err := apiGet("/jobs/" + args[1])
		if err != nil { fmt.Fprintf(os.Stderr, "Error: %v\n", err); os.Exit(1) }
		printJSON(resp)

	case "create":
		if len(args) < 4 {
			fmt.Println("Usage: bck-cli jobs create <name> <source_path> <repository_id>")
			os.Exit(1)
		}
		body := fmt.Sprintf(`{"name":"%s","source_path":"%s","repository_id":"%s"}`, args[1], args[2], args[3])
		resp, err := apiPost("/jobs", strings.NewReader(body))
		if err != nil { fmt.Fprintf(os.Stderr, "Error: %v\n", err); os.Exit(1) }
		fmt.Printf("Status: %d\n", resp.StatusCode)
		printJSON(resp)

	case "delete":
		if len(args) < 2 { fmt.Println("Usage: bck-cli jobs delete <id>"); os.Exit(1) }
		resp, err := apiDelete("/jobs/" + args[1])
		if err != nil { fmt.Fprintf(os.Stderr, "Error: %v\n", err); os.Exit(1) }
		fmt.Printf("Status: %d\n", resp.StatusCode)

	case "runs":
		if len(args) < 2 { fmt.Println("Usage: bck-cli jobs runs <job-id>"); os.Exit(1) }
		resp, err := apiGet("/jobs/" + args[1] + "/runs")
		if err != nil { fmt.Fprintf(os.Stderr, "Error: %v\n", err); os.Exit(1) }
		printJSON(resp)

	default:
		fmt.Printf("Unknown subcommand: %s\n", args[0])
	}
}

func cmdRepos(args []string) {
	if len(args) < 1 {
		fmt.Println("Usage: bck-cli repos <list|create|delete>")
		os.Exit(1)
	}

	switch args[0] {
	case "list":
		resp, _ := apiGet("/repositories")
		printJSON(resp)

	case "create":
		if len(args) < 2 { fmt.Println("Usage: bck-cli repos create <name>"); os.Exit(1) }
		body := fmt.Sprintf(`{"name":"%s","storage_type":"local"}`, args[1])
		resp, _ := apiPost("/repositories", strings.NewReader(body))
		printJSON(resp)

	case "delete":
		if len(args) < 2 { fmt.Println("Usage: bck-cli repos delete <id>"); os.Exit(1) }
		resp, _ := apiDelete("/repositories/" + args[1])
		fmt.Printf("Status: %d\n", resp.StatusCode)

	default:
		fmt.Printf("Unknown subcommand: %s\n", args[0])
	}
}

func cmdAgents(args []string) {
	if len(args) < 1 {
		fmt.Println("Usage: bck-cli agents <list|register>")
		os.Exit(1)
	}

	switch args[0] {
	case "list":
		resp, _ := apiGet("/agents")
		printJSON(resp)

	case "register":
		if len(args) < 3 { fmt.Println("Usage: bck-cli agents register <name> <address> <port>"); os.Exit(1) }
		body := fmt.Sprintf(`{"name":"%s","address":"%s","port":%s}`, args[1], args[2], args[3])
		resp, _ := apiPost("/agents", strings.NewReader(body))
		printJSON(resp)

	default:
		fmt.Printf("Unknown subcommand: %s\n", args[0])
	}
}

func cmdSnapshots(args []string) {
	resp, _ := apiGet("/snapshots")
	printJSON(resp)
}

func cmdRestore(args []string) {
	if len(args) < 1 || args[0] != "start" {
		fmt.Println("Usage: bck-cli restore start <snapshot-id> <target-path>")
		os.Exit(1)
	}
	if len(args) < 3 { fmt.Println("Usage: bck-cli restore start <snapshot-id> <target-path>"); os.Exit(1) }
	body := fmt.Sprintf(`{"snapshot_id":"%s","target_path":"%s"}`, args[1], args[2])
	resp, _ := apiPost("/restore", strings.NewReader(body))
	fmt.Printf("Status: %d\n", resp.StatusCode)
	printJSON(resp)
}

func cmdStats() {
	resp, _ := apiGet("/stats")
	printJSON(resp)
}

func cmdHealth() {
	resp, _ := apiGet("/health")
	printJSON(resp)
}

func cmdRun(args []string) {
	if len(args) < 1 {
		fmt.Println("Usage: bck-cli run <job-id>")
		os.Exit(1)
	}
	resp, _ := apiPost("/jobs/"+args[0]+"/run", nil)
	fmt.Printf("Status: %d\n", resp.StatusCode)
	printJSON(resp)
}
