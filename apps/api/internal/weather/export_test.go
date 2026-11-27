package weather

import "context"

// OpenMeteoTimeout is how long one question to Open-Meteo may take.
const OpenMeteoTimeout = openMeteoTimeout

// Ask is the shared question itself, without the look at the cache that
// comes before it and without the sharing.
func (s *Service) Ask(ctx context.Context, userID string, cell Cell) (Report, error) {
	return s.ask(ctx, userID, cell)
}

// OnWaiting has f told each time a request starts to wait for a question.
func (s *Service) OnWaiting(f func()) { s.waiting = f }
