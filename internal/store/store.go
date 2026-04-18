package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA synchronous=NORMAL",
		"PRAGMA busy_timeout=5000",
	} {
		if _, err := s.db.Exec(pragma); err != nil {
			return fmt.Errorf("%s: %w", pragma, err)
		}
	}
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS snippets (
			id         TEXT PRIMARY KEY,
			code       TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)
	`)
	return err
}

func (s *Store) SaveSnippet(code string) (string, error) {
	id, err := newID()
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(
		`INSERT INTO snippets (id, code, created_at) VALUES (?, ?, ?)`,
		id, code, time.Now().Unix(),
	)
	if err != nil {
		return "", fmt.Errorf("insert snippet: %w", err)
	}
	return id, nil
}

func (s *Store) GetSnippet(id string) (string, bool, error) {
	var code string
	err := s.db.QueryRow(`SELECT code FROM snippets WHERE id = ?`, id).Scan(&code)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("query snippet: %w", err)
	}
	return code, true, nil
}

func newID() (string, error) {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	id := base64.RawURLEncoding.EncodeToString(b)
	return strings.TrimRight(id, "="), nil
}
