package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	netmail "net/mail"
	"os"
	"path/filepath"
	"time"
)

// Outbox writes each message as a JSON file into Dir, in the format the
// Next.js server wrote (until B7.6): development and the e2e tests read the
// links from there. Nothing is sent.
type Outbox struct {
	Dir  string
	From netmail.Address
}

// outboxRecord is one file. The member order is the Next.js one.
type outboxRecord struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Subject   string `json:"subject"`
	Text      string `json:"text"`
	HTML      string `json:"html"`
	CreatedAt string `json:"createdAt"`
}

// Send writes the message to a new file, readable by the owner only, named
// by the time and a random id so that names sort by time and never collide.
func (o *Outbox) Send(_ context.Context, m Message) error {
	to, err := recipient(m.To)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(o.Dir, 0o700); err != nil {
		return fmt.Errorf("mail: outbox directory: %w", err)
	}
	now := time.Now().UTC()
	from := o.From.Address
	if o.From.Name != "" {
		from = o.From.Name + " <" + o.From.Address + ">"
	}
	var content bytes.Buffer
	enc := json.NewEncoder(&content)
	enc.SetEscapeHTML(false) // the file holds the HTML as it is
	enc.SetIndent("", "  ")
	if err := enc.Encode(outboxRecord{
		From: from, To: to, Subject: m.Subject, Text: m.Text, HTML: m.HTML,
		CreatedAt: now.Format("2006-01-02T15:04:05.000Z"),
	}); err != nil {
		return fmt.Errorf("mail: outbox record: %w", err)
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return fmt.Errorf("mail: outbox file name: %w", err)
	}
	id[6], id[8] = id[6]&0x0f|0x40, id[8]&0x3f|0x80 // a version 4 UUID, as the Next.js server names its files
	name := fmt.Sprintf("%d-%x-%x-%x-%x-%x.json", now.UnixMilli(), id[0:4], id[4:6], id[6:8], id[8:10], id[10:16])
	// Created exclusively and written in one call: a reader sees the whole
	// record or (for an instant) an empty file, never half of one.
	f, err := os.OpenFile(filepath.Join(o.Dir, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("mail: outbox file: %w", err)
	}
	if _, err := f.Write(bytes.TrimRight(content.Bytes(), "\n")); err != nil {
		_ = f.Close()
		return fmt.Errorf("mail: outbox file: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("mail: outbox file: %w", err)
	}
	return nil
}
