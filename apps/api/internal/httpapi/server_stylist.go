package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"lookly/internal/apierr"
	"lookly/internal/httpapi/contract"
	"lookly/internal/idempotency"
	"lookly/internal/stylist"
)

// The Next.js route's messages of the stylist chat.
const (
	msgConversationNotFound = "Suhbat topilmadi."
	msgStylistUnavailable   = "AI stilist hozir javob bera olmadi. Xabaringiz saqlanmadi — birozdan so‘ng qayta yuboring."
	msgStylistQuota         = "Bugungi AI stilist limiti tugadi. Limit Toshkent vaqti bilan yarim tunda yangilanadi."
	// stylistRetryAfter is the wait an unavailable stylist asks for.
	stylistRetryAfter = 15 * time.Second
	// ChatTimeout bounds a chat request: the stylist's 50 s for the model,
	// and the reading and storing around it, inside the server's 60 s write
	// timeout.
	ChatTimeout = 55 * time.Second
)

// chatRequest is the turn a judged body asks for (the gate's body rule has
// trimmed it); an event that is empty after trimming is none.
func chatRequest(body *contract.StylistChatRequest) stylist.Request {
	r := stylist.Request{Message: body.Message}
	if id, err := body.ConversationId.Get(); err == nil {
		r.ConversationID = &id
	}
	if w, err := body.Weather.Get(); err == nil {
		r.Weather = &stylist.PartialWeather{
			Temperature: w.Temperature, FeelsLike: w.FeelsLike, Condition: w.Condition,
			PrecipitationProbability: w.PrecipitationProbability, Humidity: w.Humidity, WindSpeed: w.WindSpeed, UVIndex: w.UvIndex,
		}
	}
	if event, err := body.Event.Get(); err == nil && event != "" {
		r.Event = &event
	}
	return r
}

// StylistChat: one turn of the stylist chat. The gate's body rule has
// judged the body; the Idempotency-Key is judged after it, as the Next.js
// route does.
func (s *Server) StylistChat(ctx context.Context, request contract.StylistChatRequestObject) (contract.StylistChatResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	if request.Body == nil {
		return nil, errors.New("stylist chat: the gate's body rule left no body")
	}
	key, _, refusal := IdempotencyKey(requestFrom(ctx))
	if refusal != nil {
		return nil, refusal
	}
	reply, err := s.s.Stylist.Chat(ctx, id.UserID, chatRequest(request.Body), key)
	if err != nil {
		return nil, chatError(err)
	}
	body := contract.StylistChatResponse{ConversationId: reply.ConversationID, AssistantMessage: reply.Text}
	body.ContextSummary.WardrobeItemCount = reply.Summary.WardrobeItemCount
	body.ContextSummary.WeatherProvided = reply.Summary.WeatherProvided
	body.ContextSummary.EventProvided = reply.Summary.EventProvided
	return chatResponse{body: body, replayed: reply.Replayed}, nil
}

type chatResponse struct {
	body     contract.StylistChatResponse
	replayed bool
}

func (r chatResponse) VisitStylistChatResponse(w http.ResponseWriter) error {
	if r.replayed {
		w.Header().Set("Idempotent-Replayed", "true")
	}
	return writeJSON(w, http.StatusOK, r.body)
}

func chatError(err error) error {
	var failure *stylist.Failure
	var busy *idempotency.InProgressError
	switch {
	case errors.As(err, &failure) && failure.Kind == stylist.QuotaExceeded:
		e := apierr.With(apierr.AiQuotaExceeded, msgStylistQuota)
		e.RetryAfter = failure.RetryAfter
		return e
	case errors.As(err, &failure):
		e := apierr.With(apierr.AiUnavailable, msgStylistUnavailable)
		e.RetryAfter = stylistRetryAfter
		return e
	case errors.Is(err, stylist.ErrConversationNotFound):
		return apierr.With(apierr.NotFound, msgConversationNotFound)
	case errors.Is(err, stylist.ErrReplayGone):
		return apierr.New(apierr.NotFound)
	case errors.Is(err, stylist.ErrNoUser):
		// The account was deleted after the gate let the request in.
		return apierr.New(apierr.Unauthorized)
	case errors.Is(err, idempotency.ErrMismatch):
		return apierr.New(apierr.IdempotencyKeyMismatch)
	case errors.As(err, &busy):
		e := apierr.New(apierr.IdempotencyInProgress)
		e.RetryAfter = busy.RetryAfter
		return e
	case errors.Is(err, idempotency.ErrClaimLost):
		// Another request with the key took this one's place while it ran:
		// that one answers; this one stored nothing.
		e := apierr.New(apierr.IdempotencyInProgress)
		e.RetryAfter = 5 * time.Second
		return e
	}
	return err
}

// ListConversations: the caller's latest changed conversations.
func (s *Server) ListConversations(ctx context.Context, _ contract.ListConversationsRequestObject) (contract.ListConversationsResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	found, err := s.s.Stylist.Conversations(ctx, id.UserID)
	if err != nil {
		return nil, err
	}
	body := conversationListBody{Conversations: make([]conversationSummaryBody, len(found))}
	for i, c := range found {
		body.Conversations[i] = conversationSummaryBody{
			ID: c.ID, Title: c.Title, UpdatedAt: isoMillis(c.UpdatedAt), LastMessage: c.LastMessage, LastRole: c.LastRole,
		}
	}
	return conversationListResponse{body}, nil
}

type conversationListBody struct {
	Conversations []conversationSummaryBody `json:"conversations"`
}

type conversationSummaryBody struct {
	ID          string  `json:"id"`
	Title       *string `json:"title"`
	UpdatedAt   string  `json:"updatedAt"`
	LastMessage *string `json:"lastMessage"`
	LastRole    *string `json:"lastRole"`
}

type conversationListResponse struct{ body conversationListBody }

func (r conversationListResponse) VisitListConversationsResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}

// GetConversation: one of the caller's conversations with its messages.
func (s *Server) GetConversation(ctx context.Context, request contract.GetConversationRequestObject) (contract.GetConversationResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	c, err := s.s.Stylist.Conversation(ctx, id.UserID, itemID(request.Id))
	if errors.Is(err, stylist.ErrConversationNotFound) {
		return nil, apierr.New(apierr.NotFound)
	}
	if err != nil {
		return nil, err
	}
	body := conversationBody{
		ID: c.ID, Title: c.Title, CreatedAt: isoMillis(c.CreatedAt), UpdatedAt: isoMillis(c.UpdatedAt),
		Messages: make([]messageBody, len(c.Messages)),
	}
	for i, m := range c.Messages {
		body.Messages[i] = messageBody{ID: m.ID, Role: m.Role, Content: m.Content, CreatedAt: isoMillis(m.CreatedAt)}
	}
	return conversationResponse{conversationEnvelope{body}}, nil
}

// conversationBody is the conversation the contract describes (the Next.js
// route also sent its owner and its stored context, which no client reads).
type conversationBody struct {
	ID        string        `json:"id"`
	Title     *string       `json:"title"`
	CreatedAt string        `json:"createdAt"`
	UpdatedAt string        `json:"updatedAt"`
	Messages  []messageBody `json:"messages"`
}

type messageBody struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

type conversationEnvelope struct {
	Conversation conversationBody `json:"conversation"`
}

type conversationResponse struct{ body conversationEnvelope }

func (r conversationResponse) VisitGetConversationResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}
