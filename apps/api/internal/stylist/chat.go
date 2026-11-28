package stylist

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/ai"
	"lookly/internal/config"
	"lookly/internal/engine"
	"lookly/internal/idempotency"
	"lookly/internal/platform"
	"lookly/internal/quota"
	"lookly/internal/store"
	"lookly/internal/wardrobe"
)

// One stylist turn, as the Next.js route does it
// (apps/web/src/app/api/v1/stylist/chat/route.ts and
// src/lib/ai/stylist-service.ts): the conversation's owner → the
// Idempotency-Key → a bounded context (the engine picks the outfits, the
// model explains them) → the rollout and the quota → the provider → the
// answer validated and grounded, with one correction for unknown
// references → the user's message and the answer stored together.
//
// Nothing is stored unless the whole turn succeeds: an unavailable stylist,
// a reached limit and every other failure leave the conversation as it was,
// give back the day's call and release the key.

const (
	// Route names the chat in the idempotency keys (the Next.js route's).
	Route = "POST /api/v1/stylist/chat"
	// historyRows is how many stored messages a turn reads (the context
	// keeps the last twelve meaningful ones).
	historyRows = 60
	// wardrobeRows bounds what is read of a wardrobe: above what one may hold.
	wardrobeRows = 2 * wardrobe.MaxItems
	// ConversationsShown is how many conversations the list has.
	ConversationsShown = 50
	// MessagesShown is how many of a conversation's messages are shown: the
	// newest (the Next.js route showed them all).
	MessagesShown = 1000
	// minimumAttempt: an attempt with less time left is not made.
	minimumAttempt = time.Second
	temperature    = 0.7
)

// The refusals of a turn.
var (
	// ErrConversationNotFound: the conversation is not the user's, or is gone.
	ErrConversationNotFound = errors.New("stylist: no such conversation")
	// ErrReplayGone: the request's key was completed earlier, and its
	// answer is gone since (the conversation was deleted).
	ErrReplayGone = errors.New("stylist: the earlier answer is gone")
	// ErrNoUser: the account was deleted while the turn ran.
	ErrNoUser = errors.New("stylist: the user is gone")
)

// The kinds of a Failure.
const (
	// Unavailable: no answer now (the rollout, the provider, an invalid
	// answer); nothing was stored or counted.
	Unavailable = "ai_unavailable"
	// QuotaExceeded: the day's limit is reached.
	QuotaExceeded = "quota_exceeded"
)

// Failure is a turn the stylist could not answer.
type Failure struct {
	Kind string
	// RetryAfter is when the next day's count begins (QuotaExceeded).
	RetryAfter time.Duration
}

func (f *Failure) Error() string { return "stylist: " + f.Kind }

// TextClient asks a text model (*ai.Client).
type TextClient interface {
	TextProviderOf(feature ai.Feature) (provider, model string)
	GenerateText(ctx context.Context, feature ai.Feature, request ai.TextRequest) (ai.TextResult, error)
}

// Quotas charge and refund the day's turns (*quota.Service).
type Quotas interface {
	Charge(ctx context.Context, userID string, feature ai.Feature, provider string) (quota.Charge, error)
	Refund(ctx context.Context, charge quota.Charge, reason string)
}

// Monitor is told about each turn (*ai.Monitor).
type Monitor interface {
	RecordCall(ctx context.Context, record ai.CallRecord)
	RecordRequest(ctx context.Context, record ai.RequestRecord)
}

// Keys claim and release Idempotency-Keys (*idempotency.Service).
type Keys interface {
	Begin(ctx context.Context, r idempotency.Request) (*idempotency.Claim, *idempotency.Replay, error)
	Release(ctx context.Context, c idempotency.Claim) error
}

// Config is what the Service works with.
type Config struct {
	Pool    *pgxpool.Pool
	Keys    Keys
	Client  TextClient
	Quotas  Quotas
	Monitor Monitor
	// Route is the stylist's settings (the time limit of one attempt).
	Route   config.AIRoute
	Rollout config.AIRollout
	Log     *slog.Logger
	// Deadline bounds a turn's provider calls together (zero: DeadlineMs).
	Deadline time.Duration
	// Now is the clock of the deadline and the latencies (nil: the real one).
	Now func() time.Time
}

// Service is the stylist chat and its conversations.
type Service struct{ c Config }

// New returns the service.
func New(c Config) *Service {
	if c.Deadline == 0 {
		c.Deadline = DeadlineMs * time.Millisecond
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	return &Service{c: c}
}

// Summary is what the stylist was given for an answer.
type Summary struct {
	WardrobeItemCount int
	WeatherProvided   bool
	EventProvided     bool
}

// Reply is a turn's answer.
type Reply struct {
	ConversationID string
	// Text is the answer with the references resolved to item names.
	Text    string
	Summary Summary
	// Replayed: the answer of an earlier request with the same key.
	Replayed bool
}

// Chat answers one message of the user. key is the request's
// Idempotency-Key ("" for none). The refusals: ErrConversationNotFound,
// ErrReplayGone, ErrNoUser, *Failure, idempotency.ErrMismatch,
// *idempotency.InProgressError and idempotency.ErrClaimLost.
func (s *Service) Chat(ctx context.Context, userID string, r Request, key string) (Reply, error) {
	q := store.New(s.c.Pool)
	// 1. Ownership: an unknown or foreign id is not found, never a new
	// conversation.
	if r.ConversationID != nil {
		if _, err := q.ConversationOfUser(ctx, store.ConversationOfUserParams{ID: *r.ConversationID, UserID: userID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Reply{}, ErrConversationNotFound
			}
			return Reply{}, fmt.Errorf("stylist: conversation: %w", err)
		}
	}

	// 2. The key, claimed before any AI work.
	var claim *idempotency.Claim
	if key != "" {
		c, replay, err := s.c.Keys.Begin(ctx, idempotency.Request{UserID: userID, Route: Route, Key: key, Hash: r.Hash()})
		if err != nil {
			return Reply{}, err
		}
		if replay != nil {
			provider, _ := s.c.Client.TextProviderOf(ai.StylistChat)
			s.c.Monitor.RecordRequest(ctx, ai.RequestRecord{Feature: ai.StylistChat, Provider: provider, Outcome: "replay"})
			return s.replay(ctx, q, userID, replay)
		}
		claim = c
	}
	reply, err := s.answer(ctx, userID, r, claim)
	if err != nil && claim != nil {
		if released := s.c.Keys.Release(context.WithoutCancel(ctx), *claim); released != nil {
			s.c.Log.ErrorContext(ctx, "stylist: the idempotency key could not be released", "err", released.Error())
		}
	}
	return reply, err
}

// assistantMetadata is what is stored with an answer, member by member as
// the Next.js route wrote it.
type assistantMetadata struct {
	WardrobeItemCount int      `json:"wardrobeItemCount"`
	WeatherProvided   bool     `json:"weatherProvided"`
	EventProvided     bool     `json:"eventProvided"`
	Provider          string   `json:"provider"`
	Model             string   `json:"model"`
	PromptVersion     string   `json:"promptVersion"`
	ReferencedItemIDs []string `json:"referencedItemIds"`
	NeedsMoreInfo     bool     `json:"needsMoreInfo"`
}

// replay is the answer stored by the request that completed the key.
func (s *Service) replay(ctx context.Context, q *store.Queries, userID string, r *idempotency.Replay) (Reply, error) {
	if r.ResourceID == nil {
		return Reply{}, ErrReplayGone
	}
	row, err := q.AnswerOfUser(ctx, store.AnswerOfUserParams{UserID: userID, ID: *r.ResourceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Reply{}, ErrReplayGone
	}
	if err != nil {
		return Reply{}, fmt.Errorf("stylist: replay: %w", err)
	}
	// What the answer's metadata does not say counts as nothing.
	var meta struct {
		WardrobeItemCount *int  `json:"wardrobeItemCount"`
		WeatherProvided   *bool `json:"weatherProvided"`
		EventProvided     *bool `json:"eventProvided"`
	}
	if err := json.Unmarshal([]byte(row.MetadataJson), &meta); err != nil {
		s.c.Log.WarnContext(ctx, "stylist: a stored answer's metadata is not readable; the replay says nothing of its context", "message", *r.ResourceID)
	}
	summary := Summary{}
	if meta.WardrobeItemCount != nil {
		summary.WardrobeItemCount = *meta.WardrobeItemCount
	}
	if meta.WeatherProvided != nil {
		summary.WeatherProvided = *meta.WeatherProvided
	}
	if meta.EventProvided != nil {
		summary.EventProvided = *meta.EventProvided
	}
	return Reply{ConversationID: row.ConversationId, Text: row.Content, Summary: summary, Replayed: true}, nil
}

// answer runs the turn and stores it, completing the claim (when there is
// one) in the same transaction.
func (s *Service) answer(ctx context.Context, userID string, r Request, claim *idempotency.Claim) (Reply, error) {
	// 3. What the context may use.
	var data loaded
	err := pgx.BeginTxFunc(ctx, s.c.Pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) (err error) {
		data, err = s.load(ctx, store.New(tx), userID, r.ConversationID)
		return err
	})
	if err != nil {
		return Reply{}, fmt.Errorf("stylist: load: %w", err)
	}
	weather := r.Weather.Complete()
	occasion := r.Occasion()

	// 4. The engine's candidates: the engine picks, the model explains.
	var candidates []engine.Candidate
	if len(data.items) > 0 {
		wardrobeItems := make([]engine.Item, len(data.items))
		for i, row := range data.items {
			wardrobeItems[i] = row.Item
		}
		top := float64(OutfitCandidates)
		candidates = engine.Generate(engine.Input{
			Wardrobe: wardrobeItems, Weather: engineWeather(weather), Occasion: occasion, Profile: &data.profile, TopN: &top,
		}).Outfits
	}
	built := Build(BuildInput{
		Items: data.items, Candidates: candidates, Occasion: occasion, Weather: weather,
		Preferences: &data.preferences, ColorProfile: data.colors,
	})
	summary := Summary{WardrobeItemCount: len(built.Refs), WeatherProvided: weather != nil, EventProvided: r.Event != nil}

	// 5. The AI turn.
	turn, err := s.turn(ctx, userID, r, built, data.history)
	if err != nil {
		return Reply{}, err
	}

	// 6. The exchange, stored at once.
	meta, err := json.Marshal(assistantMetadata{
		WardrobeItemCount: summary.WardrobeItemCount, WeatherProvided: summary.WeatherProvided, EventProvided: summary.EventProvided,
		Provider: turn.provider, Model: turn.model, PromptVersion: PromptVersion, ReferencedItemIDs: turn.referencedIDs, NeedsMoreInfo: turn.needsMoreInfo,
	})
	if err == nil {
		var conversationID string
		conversationID, err = s.store(ctx, userID, r, turn.text, string(meta), claim)
		if err == nil {
			return Reply{ConversationID: conversationID, Text: turn.text, Summary: summary}, nil
		}
	}
	// The provider answered but storing failed: give the call back.
	if turn.charge != nil {
		s.c.Quotas.Refund(context.WithoutCancel(ctx), *turn.charge, "storage_failed")
	}
	return Reply{}, err
}

const foreignKeyViolation = "23503"

// store writes the user's message and the answer (and the conversation,
// when the turn starts one) in one transaction. PostgreSQL refuses the NUL
// character in text: it is left out of both texts and the title (the
// metadata writes it escaped).
func (s *Service) store(ctx context.Context, userID string, r Request, answer, meta string, claim *idempotency.Claim) (conversationID string, err error) {
	err = pgx.BeginTxFunc(ctx, s.c.Pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		if r.ConversationID != nil {
			conversationID = *r.ConversationID
			// Still the user's: it may have been deleted while the turn ran.
			touched, err := q.TouchConversation(ctx, store.TouchConversationParams{ID: conversationID, UserID: userID})
			if err != nil {
				return err
			}
			if touched != 1 {
				return ErrConversationNotFound
			}
		} else {
			conversationID = platform.NewID()
			title := platform.StripNUL(r.Title())
			if err := q.CreateConversation(ctx, store.CreateConversationParams{
				ID: conversationID, UserID: userID, Title: &title, ContextJson: r.Metadata(),
			}); err != nil {
				return err
			}
		}
		if err := q.CreateMessage(ctx, store.CreateMessageParams{
			ID: platform.NewID(), ConversationID: conversationID, Role: "user", Content: platform.StripNUL(r.Message), MetadataJson: r.Metadata(), Later: 0,
		}); err != nil {
			return err
		}
		answerID := platform.NewID()
		if err := q.CreateMessage(ctx, store.CreateMessageParams{
			ID: answerID, ConversationID: conversationID, Role: "assistant", Content: answer, MetadataJson: meta, Later: 1,
		}); err != nil {
			return err
		}
		if claim != nil {
			return idempotency.Complete(ctx, q, *claim, answerID, 200)
		}
		return nil
	})
	var pgErr *pgconn.PgError
	switch {
	case errors.As(err, &pgErr) && pgErr.Code == foreignKeyViolation:
		return "", ErrNoUser
	case errors.Is(err, ErrConversationNotFound), errors.Is(err, idempotency.ErrClaimLost):
		return "", err
	case err != nil:
		return "", fmt.Errorf("stylist: store: %w", err)
	}
	return conversationID, nil
}

// ─── The turn ───────────────────────────────────────────────────────────────

// turn is a grounded answer.
type turn struct {
	// text is shown and stored: the references resolved to item names.
	text string
	// referencedIDs are the ids of the items the answer used (stored, never
	// returned).
	referencedIDs   []string
	needsMoreInfo   bool
	provider, model string
	// charge is the day's call that was counted; nil for the mock.
	charge *quota.Charge
}

// ground resolves an answer's references.
func ground(answer Answer, built Built) (text string, ids []string, err error) {
	text, err = Resolve(answer.Answer, built.Items)
	if err != nil {
		return "", nil, err
	}
	ids = make([]string, len(answer.ReferencedItems))
	for i, ref := range answer.ReferencedItems {
		ids[i] = built.Items[ref].ID
	}
	return text, ids, nil
}

func (s *Service) turn(ctx context.Context, userID string, r Request, built Built, history []HistoryRow) (turn, error) {
	provider, model := s.c.Client.TextProviderOf(ai.StylistChat)
	started := s.c.Now()
	corrected := false
	request := func(outcome, reason string, billable bool) {
		latency := s.c.Now().Sub(started)
		s.c.Monitor.RecordRequest(context.WithoutCancel(ctx), ai.RequestRecord{
			Feature: ai.StylistChat, Provider: provider, Model: model, Outcome: outcome, Reason: reason,
			Corrected: &corrected, Billable: billable, Latency: &latency,
		})
	}

	// The rollout: no provider, and no mock in its place, unless eligible.
	if eligible, reason := ai.Eligible(ai.StylistChat, userID, s.c.Rollout); !eligible {
		s.c.Monitor.RecordRequest(ctx, ai.RequestRecord{Feature: ai.StylistChat, Provider: provider, Model: model, Outcome: "disabled", Reason: reason})
		return turn{}, &Failure{Kind: Unavailable}
	}
	if provider == config.AIMock {
		answer := Mock(built.Refs, built.FirstCandidate)
		text, ids, err := ground(answer, built)
		if err != nil {
			return turn{}, fmt.Errorf("stylist: the mock's answer: %w", err)
		}
		latency := s.c.Now().Sub(started)
		s.c.Monitor.RecordCall(ctx, ai.CallRecord{Feature: ai.StylistChat, Provider: provider, Model: model, Outcome: "ok", Latency: latency, Attempts: 1})
		s.c.Monitor.RecordRequest(ctx, ai.RequestRecord{Feature: ai.StylistChat, Provider: provider, Model: model, Outcome: "ok", Latency: &latency})
		return turn{text: text, referencedIDs: ids, needsMoreInfo: answer.NeedsMoreInfo, provider: provider, model: model}, nil
	}

	// The quota, just before the provider; a refund goes to the day charged.
	charge, err := s.c.Quotas.Charge(ctx, userID, ai.StylistChat, provider)
	if err != nil {
		return turn{}, fmt.Errorf("stylist: quota: %w", err)
	}
	if !charge.Allowed {
		request(QuotaExceeded, "", false)
		return turn{}, &Failure{Kind: QuotaExceeded, RetryAfter: charge.RetryAfter}
	}
	unavailable := func(reason string) (turn, error) {
		s.c.Quotas.Refund(context.WithoutCancel(ctx), charge, reason)
		s.c.Log.WarnContext(ctx, "ai.stylist.failed", "provider", provider, "model", model, "version", PromptVersion, "reason", reason)
		request(Unavailable, reason, false)
		return turn{}, &Failure{Kind: Unavailable}
	}

	deadline := started.Add(s.c.Deadline)
	budget, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	tokens, temp := MaxOutputTokens, temperature
	schema := &ai.Schema{Name: "stylist_answer", Schema: Schema(built.Refs)}
	var messages []ai.Message
	for _, m := range Messages(built.Data, History(history), r.Message, r.Event) {
		messages = append(messages, ai.Message{Role: m.Role, Content: m.Content})
	}
	// call asks the model (each attempt within the route's time limit, all
	// of them within the deadline); ok is false when too little time is left.
	call := func(msgs []ai.Message) (text string, ok bool, err error) {
		remaining := deadline.Sub(s.c.Now()).Truncate(time.Millisecond)
		if remaining < minimumAttempt {
			return "", false, nil
		}
		result, err := s.c.Client.GenerateText(budget, ai.StylistChat, ai.TextRequest{
			Messages: msgs, Temperature: &temp, MaxOutputTokens: &tokens, JSONSchema: schema,
		})
		return result.Text, true, err
	}
	failed := func(err error) (turn, error) {
		// The turn's own time ran out (not the caller's).
		if ctx.Err() == nil && budget.Err() != nil {
			return unavailable("deadline")
		}
		var providerErr *ai.Error
		if errors.As(err, &providerErr) {
			return unavailable("provider_" + string(providerErr.Kind))
		}
		s.c.Quotas.Refund(context.WithoutCancel(ctx), charge, "internal_error")
		request("internal_error", "internal_error", false)
		return turn{}, fmt.Errorf("stylist: provider: %w", err)
	}
	// interpret validates an answer and resolves its references.
	interpret := func(text string) (answer Answer, resolved string, ids []string, err error) {
		answer, err = Interpret(text, built.Refs)
		if err == nil {
			resolved, ids, err = ground(answer, built)
		}
		return answer, resolved, ids, err
	}

	first, ok, err := call(messages)
	switch {
	case err != nil:
		return failed(err)
	case !ok:
		return unavailable("deadline")
	}
	answer, text, ids, err := interpret(first)
	if err != nil {
		// Malformed output is never retried; only unknown references get one
		// correction.
		var invalid *InvalidOutputError
		if !errors.As(err, &invalid) || invalid.Reason != InvalidReference {
			return unavailable("malformed_output")
		}
		corrected = true
		correction := append(slices.Clone(messages),
			ai.Message{Role: "assistant", Content: first},
			ai.Message{Role: "system", Content: Correction(invalid.InvalidRefs, built.Refs)})
		second, ok, err := call(correction)
		switch {
		case err != nil:
			return failed(err)
		case !ok:
			return unavailable("deadline")
		}
		answer, text, ids, err = interpret(second)
		if err != nil {
			if errors.As(err, &invalid) && invalid.Reason == InvalidReference {
				return unavailable("ungrounded_after_correction")
			}
			return unavailable("malformed_output")
		}
	}
	request("ok", "", true)
	return turn{text: platform.StripNUL(text), referencedIDs: ids, needsMoreInfo: answer.NeedsMoreInfo, provider: provider, model: model, charge: &charge}, nil
}

// ─── Loading ────────────────────────────────────────────────────────────────

// loaded is what a turn reads of the database.
type loaded struct {
	items       []WardrobeRow
	profile     engine.Profile
	preferences Preferences
	colors      *ColorProfile
	history     []HistoryRow
}

// list reads a stored JSON list of texts; what is not one counts as empty
// and is logged. what names the row and the column, never a value.
func (s *Service) list(ctx context.Context, raw string, what ...any) []string {
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil || values == nil {
		s.c.Log.WarnContext(ctx, "stylist: a stored list is not a list of texts; it counts as empty", what...)
		return []string{}
	}
	return values
}

func (s *Service) load(ctx context.Context, q *store.Queries, userID string, conversationID *string) (loaded, error) {
	var data loaded
	rows, err := q.WardrobeForStylist(ctx, store.WardrobeForStylistParams{UserID: userID, RowLimit: wardrobeRows})
	if err != nil {
		return loaded{}, fmt.Errorf("wardrobe: %w", err)
	}
	data.items = make([]WardrobeRow, len(rows))
	for i, r := range rows {
		data.items[i] = WardrobeRow{
			Item: engine.Item{
				ID: r.ID, Category: r.Category, Subcategory: r.Subcategory, Colors: s.list(ctx, r.Colors, "item", r.ID, "column", "colors"),
				Pattern: r.Pattern, Material: r.Material, SleeveLength: r.SleeveLength, Fit: r.Fit, Style: r.Style,
				Season: s.list(ctx, r.Season, "item", r.ID, "column", "season"), Gender: r.Gender, Formality: r.Formality,
			},
			CreatedAt: r.CreatedAt,
		}
	}

	// The profile and the preferences: a user may have neither row.
	data.preferences = Preferences{PreferredStyles: []string{}, DislikedStyles: []string{}, FavoriteColors: []string{}, DislikedColors: []string{}}
	var gender *string
	switch profile, err := q.UserProfileByUser(ctx, userID); {
	case err == nil:
		gender, data.preferences.PreferredFit = profile.Gender, profile.PreferredFit
	case !errors.Is(err, pgx.ErrNoRows):
		return loaded{}, fmt.Errorf("profile: %w", err)
	}
	switch preferences, err := q.UserPreferencesByUser(ctx, userID); {
	case err == nil:
		of := func(raw, column string) []string {
			return s.list(ctx, raw, "preferences", preferences.ID, "column", column)
		}
		data.preferences.PreferredStyles, data.preferences.DislikedStyles = of(preferences.PreferredStyles, "preferredStyles"), of(preferences.DislikedStyles, "dislikedStyles")
		data.preferences.FavoriteColors, data.preferences.DislikedColors = of(preferences.FavoriteColors, "favoriteColors"), of(preferences.DislikedColors, "dislikedColors")
	case !errors.Is(err, pgx.ErrNoRows):
		return loaded{}, fmt.Errorf("preferences: %w", err)
	}
	p := data.preferences
	data.profile = engine.Profile{
		Gender: gender, PreferredFit: p.PreferredFit, PreferredStyles: p.PreferredStyles, DislikedStyles: p.DislikedStyles,
		FavoriteColors: p.FavoriteColors, DislikedColors: p.DislikedColors,
	}
	// The stored colour profile's summary; never made up when there is none.
	switch colors, err := q.ColorProfileOfUser(ctx, userID); {
	case err == nil:
		of := func(raw, column string) []string {
			return s.list(ctx, raw, "colorProfile", colors.ID, "column", column)
		}
		data.colors = &ColorProfile{
			Season: colors.Season, Undertone: colors.Undertone, ContrastLevel: colors.ContrastLevel,
			RecommendedColors: of(colors.RecommendedColors, "recommendedColors"), NeutralColors: of(colors.NeutralColors, "neutralColors"),
			CautionColors: of(colors.CautionColors, "cautionColors"),
		}
	case !errors.Is(err, pgx.ErrNoRows):
		return loaded{}, fmt.Errorf("colour profile: %w", err)
	}

	if conversationID != nil {
		messages, err := q.RecentMessages(ctx, store.RecentMessagesParams{ConversationID: *conversationID, RowLimit: historyRows})
		if err != nil {
			return loaded{}, fmt.Errorf("history: %w", err)
		}
		data.history = make([]HistoryRow, len(messages))
		for i, m := range messages {
			// Unreadable metadata is no metadata, as in the Next.js route.
			var meta any = map[string]any{}
			if err := json.Unmarshal([]byte(m.MetadataJson), &meta); err != nil {
				meta = map[string]any{}
			}
			data.history[len(messages)-1-i] = HistoryRow{Role: m.Role, Content: m.Content, Metadata: meta}
		}
	}
	return data, nil
}

// ─── Conversations ──────────────────────────────────────────────────────────

// ConversationSummary is a conversation in the list.
type ConversationSummary struct {
	ID        string
	Title     *string
	UpdatedAt time.Time
	// LastMessage and LastRole are the newest message's (nil without one).
	LastMessage, LastRole *string
}

// Conversations are the user's latest changed conversations.
func (s *Service) Conversations(ctx context.Context, userID string) ([]ConversationSummary, error) {
	rows, err := store.New(s.c.Pool).ConversationsOfUser(ctx, store.ConversationsOfUserParams{UserID: userID, RowLimit: ConversationsShown})
	if err != nil {
		return nil, fmt.Errorf("stylist: conversations: %w", err)
	}
	out := make([]ConversationSummary, len(rows))
	for i, r := range rows {
		out[i] = ConversationSummary{ID: r.ID, Title: r.Title, UpdatedAt: r.UpdatedAt, LastMessage: r.LastContent, LastRole: r.LastRole}
	}
	return out, nil
}

// StoredMessage is a message of a conversation.
type StoredMessage struct {
	ID, Role, Content string
	CreatedAt         time.Time
}

// Conversation is a conversation with its messages, the oldest first.
type Conversation struct {
	ID                   string
	Title                *string
	CreatedAt, UpdatedAt time.Time
	Messages             []StoredMessage
}

// Conversation is one of the user's conversations; ErrConversationNotFound
// when it is not the user's.
func (s *Service) Conversation(ctx context.Context, userID, id string) (Conversation, error) {
	var out Conversation
	err := pgx.BeginTxFunc(ctx, s.c.Pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := store.New(tx)
		c, err := q.ConversationOfUser(ctx, store.ConversationOfUserParams{ID: id, UserID: userID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrConversationNotFound
		}
		if err != nil {
			return err
		}
		rows, err := q.MessagesOfConversation(ctx, store.MessagesOfConversationParams{ConversationID: id, RowLimit: MessagesShown})
		if err != nil {
			return err
		}
		out = Conversation{ID: c.ID, Title: c.Title, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt, Messages: make([]StoredMessage, len(rows))}
		for i, m := range rows {
			out.Messages[len(rows)-1-i] = StoredMessage{ID: m.ID, Role: m.Role, Content: m.Content, CreatedAt: m.CreatedAt}
		}
		return nil
	})
	switch {
	case errors.Is(err, ErrConversationNotFound):
		return Conversation{}, err
	case err != nil:
		return Conversation{}, fmt.Errorf("stylist: conversation: %w", err)
	}
	return out, nil
}
