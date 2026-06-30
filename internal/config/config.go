package config

import (
	"fmt"
	"time"

	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

type Config struct {
	Server   ServerConfig   `mapstructure:"server"`
	Database DatabaseConfig `mapstructure:"database"`
	Redis    RedisConfig    `mapstructure:"redis"`
	Auth     AuthConfig     `mapstructure:"auth"`
	Storage  StorageConfig  `mapstructure:"storage"`
	CORS     CORSConfig     `mapstructure:"cors"`
	Logging  LoggingConfig  `mapstructure:"logging"`
	SMTP     SMTPConfig     `mapstructure:"smtp"`
	Telegram TelegramConfig `mapstructure:"telegram"`
}

type ServerConfig struct {
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
}

func (s ServerConfig) Addr() string {
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

type DatabaseConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Name     string `mapstructure:"name"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	SSLMode  string `mapstructure:"sslmode"`
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode,
	)
}

type RedisConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

func (r RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

type AuthConfig struct {
	JWTSecret          string        `mapstructure:"jwt_secret"`
	RefreshSecret      string        `mapstructure:"refresh_secret"`
	TokenExpiry        time.Duration `mapstructure:"token_expiry"`
	RefreshTokenExpiry time.Duration `mapstructure:"refresh_token_expiry"`
}

type StorageConfig struct {
	Type  string            `mapstructure:"type"`
	Local LocalStorageConfig `mapstructure:"local"`
}

type LocalStorageConfig struct {
	Path string `mapstructure:"path"`
}

type CORSConfig struct {
	AllowedOrigins []string `mapstructure:"allowed_origins"`
}

type LoggingConfig struct {
	Level  string `mapstructure:"level"`
	Format string `mapstructure:"format"`
}

type SMTPConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	From     string `mapstructure:"from"`
}

type TelegramConfig struct {
	BotToken string `mapstructure:"bot_token"`
	ChatID   string `mapstructure:"chat_id"`
}

func Load() (*Config, error) {
	// Load .env file first
	godotenv.Load()

	v := viper.New()

	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath("./configs")
	v.AddConfigPath(".")

	v.AutomaticEnv()

	bindEnvs(v)

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("read config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	cfg.applyDefaults()

	return &cfg, nil
}

func bindEnvs(v *viper.Viper) {
	v.BindEnv("server.host", "SERVER_HOST")
	v.BindEnv("server.port", "SERVER_PORT")
	v.BindEnv("database.host", "DB_HOST")
	v.BindEnv("database.port", "DB_PORT")
	v.BindEnv("database.name", "DB_NAME")
	v.BindEnv("database.user", "DB_USER")
	v.BindEnv("database.password", "DB_PASSWORD")
	v.BindEnv("database.sslmode", "DB_SSLMODE")
	v.BindEnv("redis.host", "REDIS_HOST")
	v.BindEnv("redis.port", "REDIS_PORT")
	v.BindEnv("auth.jwt_secret", "JWT_SECRET")
	v.BindEnv("auth.refresh_secret", "JWT_REFRESH_SECRET")
	v.BindEnv("auth.token_expiry", "TOKEN_EXPIRY")
	v.BindEnv("auth.refresh_token_expiry", "REFRESH_TOKEN_EXPIRY")
	v.BindEnv("storage.type", "STORAGE_TYPE")
	v.BindEnv("storage.local.path", "STORAGE_LOCAL_PATH")
	v.BindEnv("cors.allowed_origins", "CORS_ALLOWED_ORIGINS")
	v.BindEnv("logging.level", "LOG_LEVEL")
	v.BindEnv("logging.format", "LOG_FORMAT")
	v.BindEnv("smtp.host", "SMTP_HOST")
	v.BindEnv("smtp.port", "SMTP_PORT")
	v.BindEnv("smtp.user", "SMTP_USER")
	v.BindEnv("smtp.password", "SMTP_PASSWORD")
	v.BindEnv("smtp.from", "SMTP_FROM")
	v.BindEnv("telegram.bot_token", "TELEGRAM_BOT_TOKEN")
	v.BindEnv("telegram.chat_id", "TELEGRAM_CHAT_ID")
}

func (c *Config) applyDefaults() {
	if c.Server.Host == "" {
		c.Server.Host = "0.0.0.0"
	}
	if c.Server.Port == 0 {
		c.Server.Port = 8050
	}
	if c.Database.Host == "" {
		c.Database.Host = "localhost"
	}
	if c.Database.Port == 0 {
		c.Database.Port = 5432
	}
	if c.Database.Name == "" {
		c.Database.Name = "backupmanager"
	}
	if c.Database.User == "" {
		c.Database.User = "backup"
	}
	if c.Database.Password == "" {
		c.Database.Password = "backup"
	}
	if c.Database.SSLMode == "" {
		c.Database.SSLMode = "disable"
	}
	if c.Redis.Host == "" {
		c.Redis.Host = "localhost"
	}
	if c.Redis.Port == 0 {
		c.Redis.Port = 6379
	}
	if c.Storage.Type == "" {
		c.Storage.Type = "local"
	}
	if c.Storage.Local.Path == "" {
		c.Storage.Local.Path = "./repos"
	}
	if c.Logging.Level == "" {
		c.Logging.Level = "info"
	}
	if c.Logging.Format == "" {
		c.Logging.Format = "json"
	}
	if c.Auth.JWTSecret == "" {
		c.Auth.JWTSecret = "dev-secret-change-in-production"
	}
	if c.Auth.RefreshSecret == "" {
		c.Auth.RefreshSecret = "dev-refresh-change-in-production"
	}
	if c.Auth.TokenExpiry == 0 {
		c.Auth.TokenExpiry = 24 * time.Hour
	}
	if c.Auth.RefreshTokenExpiry == 0 {
		c.Auth.RefreshTokenExpiry = 30 * 24 * time.Hour
	}
	if len(c.CORS.AllowedOrigins) == 0 {
		c.CORS.AllowedOrigins = []string{"http://localhost:3000"}
	}
}
