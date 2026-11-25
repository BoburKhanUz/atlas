package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"lookly/internal/health"
	"lookly/internal/httpapi/contract"
)

// Services are the domain services the handlers call.
type Services struct {
	Health *health.Service
}

// Server implements the generated contract interface. Each method decodes
// nothing itself (the generated code does), calls one service method and
// encodes the answer.
type Server struct {
	s Services
}

var _ contract.StrictServerInterface = (*Server)(nil)

// NewServer returns the contract implementation over the services.
func NewServer(s Services) *Server { return &Server{s: s} }

// GetHealth: 200 when the database answers, 503 when it does not (the body
// says which; Docker and monitoring read the status). Never cached.
func (s *Server) GetHealth(ctx context.Context, _ contract.GetHealthRequestObject) (contract.GetHealthResponseObject, error) {
	body := contract.HealthResponse{
		Status:   contract.HealthResponseStatusOk,
		Database: contract.HealthResponseDatabaseOk,
		Version:  s.s.Health.Version(),
	}
	status := http.StatusOK
	if err := s.s.Health.CheckDatabase(ctx); err != nil {
		if info := infoFrom(ctx); info != nil {
			info.log.Warn("health check: database unreachable", "requestId", info.id, "err", err.Error())
		}
		body.Status = contract.HealthResponseStatusDegraded
		body.Database = contract.HealthResponseDatabaseUnreachable
		status = http.StatusServiceUnavailable
	}
	return healthResponse{status: status, body: body}, nil
}

// healthResponse adds Cache-Control: no-store, which the generated response
// types cannot carry (the contract documents no headers for health).
type healthResponse struct {
	status int
	body   contract.HealthResponse
}

func (r healthResponse) VisitGetHealthResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(r.status)
	return json.NewEncoder(w).Encode(r.body)
}
