package migrations_test

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"lookly/internal/contracttest"
	"lookly/migrations"
)

// The Prisma migrations are kept as test data (testdata/prisma, copied from
// the last commit that had apps/web/prisma, docs/plan/B7.md): the tests build
// a database Prisma made from them. They must be exactly the history
// `lookly migrate` accepts, or those tests prove nothing.
func TestThePrismaTestDataIsExactlyPrismaHistory(t *testing.T) {
	t.Parallel()
	files, err := filepath.Glob(contracttest.RepoPath("apps/api/testdata/prisma/migrations/*/migration.sql"))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, file := range files {
		info, err := os.Stat(file)
		if err != nil {
			t.Fatal(err)
		}
		if info.Size() == 0 {
			t.Errorf("%s is empty", file)
		}
		names = append(names, filepath.Base(filepath.Dir(file)))
	}
	slices.Sort(names)
	if !slices.Equal(names, migrations.PrismaHistory) {
		t.Fatalf("testdata/prisma/migrations holds %v, PrismaHistory is %v", names, migrations.PrismaHistory)
	}
}
