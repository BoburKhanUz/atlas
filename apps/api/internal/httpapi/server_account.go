package httpapi

import (
	"context"
	"errors"
	"net/http"

	"lookly/internal/apierr"
	"lookly/internal/httpapi/contract"
	"lookly/internal/legal"
)

// The account operations of stage B3 (docs/plan/B3.md): the legal texts and
// the renewed consent, the profile, the password reset, the deletion of the
// account.

// GetLegalDocuments is the current privacy policy and terms of use. Public.
func (s *Server) GetLegalDocuments(context.Context, contract.GetLegalDocumentsRequestObject) (contract.GetLegalDocumentsResponseObject, error) {
	return legalDocuments{}, nil
}

// legalDocuments writes the embedded texts as they are: they are the
// contract's LegalResponse already (a test holds them to it).
type legalDocuments struct{}

func (legalDocuments) VisitGetLegalDocumentsResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, err := w.Write(legal.Documents())
	return err
}

// AcceptLegalDocuments records the signed-in user's consent to the current
// texts (the gate's body rule refuses any other version). Served although
// the consent is out of date: that is what it is for.
func (s *Server) AcceptLegalDocuments(ctx context.Context, request contract.AcceptLegalDocumentsRequestObject) (contract.AcceptLegalDocumentsResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	err := s.s.Legal.Accept(ctx, id.UserID, request.Body.AcceptedLegalVersion, request.Body.AgeConfirmed)
	if errors.Is(err, legal.ErrNoUser) {
		// The account was deleted after the gate let the request in.
		return nil, apierr.New(apierr.Unauthorized)
	}
	if err != nil {
		return nil, err
	}
	return contract.AcceptLegalDocuments200JSONResponse{Ok: true}, nil
}
