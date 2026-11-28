package httpapi

import (
	"context"
	"errors"
	"net/http"

	"lookly/internal/apierr"
	"lookly/internal/clienterrors"
	"lookly/internal/httpapi/contract"
)

// clientReports are the reports of a judged body.
func clientReports(body contract.ClientErrorsRequest) []clienterrors.Report {
	out := make([]clienterrors.Report, len(body.Reports))
	for i, r := range body.Reports {
		out[i] = clienterrors.Report{
			Platform: string(r.Platform), AppVersion: r.AppVersion, OSVersion: r.OsVersion, Kind: string(r.Kind),
			ErrorType: r.ErrorType, Message: r.Message, Stack: r.Stack, Route: r.Route, OccurredAt: r.OccurredAt,
		}
		if r.Fatal != nil {
			out[i].Fatal = *r.Fatal
		}
	}
	return out
}

// ReportClientErrors: the apps' error reports, logged and never stored. No
// session is needed (errors happen before sign-in too). The gate's body
// rule has judged the body.
func (s *Server) ReportClientErrors(ctx context.Context, request contract.ReportClientErrorsRequestObject) (contract.ReportClientErrorsResponseObject, error) {
	if request.Body == nil {
		return nil, errors.New("client errors: the gate's body rule left no body")
	}
	addr := ""
	if a, ok := ClientAddr(requestFrom(ctx), s.s.TrustProxy); ok {
		addr = a.String()
	}
	err := s.s.Reports.Report(ctx, addr, clientReports(*request.Body))
	var limited *clienterrors.LimitedError
	if errors.As(err, &limited) {
		return nil, apierr.TooManyAttempts(limited.RetryAfter)
	}
	if err != nil {
		return nil, err
	}
	return contract.ReportClientErrors200JSONResponse{Ok: true}, nil
}

// GetOpenApiDocument: the API contract (docs/api/openapi.json), as it is.
// Public: it holds no secret.
func (s *Server) GetOpenApiDocument(context.Context, contract.GetOpenApiDocumentRequestObject) (contract.GetOpenApiDocumentResponseObject, error) {
	return openAPIDocument{}, nil
}

type openAPIDocument struct{}

func (openAPIDocument) VisitGetOpenApiDocumentResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, err := w.Write(contract.Document)
	return err
}
