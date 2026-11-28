package wardrobe

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Tx runs a transaction, as pgx.BeginTxFunc does.
type Tx = func(ctx context.Context, pool *pgxpool.Pool, options pgx.TxOptions, fn func(pgx.Tx) error) error

// SetTx replaces what runs the transaction that creates an item's rows: for
// failures of a transaction that no database at hand produces on demand
// (an answer lost after the commit).
func (u *Uploads) SetTx(run Tx) { u.inTx = run }
