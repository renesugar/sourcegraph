package repos

import (
	"context"
	"time"

	multierror "github.com/hashicorp/go-multierror"
	"github.com/k0kubun/pp"
	log15 "gopkg.in/inconshreveable/log15.v2"
)

// A Syncer periodically synchronizes available repositories from all its given Sources
// with the stored Repositories in Sourcegraph.
type Syncer struct {
	interval time.Duration
	sources  map[string]Source
	store    Store
	diffs    chan Diff
	now      func() time.Time
}

// NewSyncer returns a new Syncer with the given parameters.
func NewSyncer(interval time.Duration, store Store, sources map[string]Source, diffs chan Diff, now func() time.Time) *Syncer {
	return &Syncer{
		interval: interval,
		sources:  sources,
		store:    store,
		diffs:    diffs,
		now:      now,
	}
}

// Run runs the Sync at its specified interval.
func (s Syncer) Run(ctx context.Context) error {
	for ctx.Err() == nil {
		if err := s.Sync(ctx); err != nil {
			log15.Error("Syncer", "err", err)
		}

		time.Sleep(s.interval)
	}

	return ctx.Err()
}

// Sync synchronizes the set of sourced repos with the set of stored repos.
func (s Syncer) Sync(ctx context.Context) (err error) {
	// TODO(tsenart): Ensure that transient failures do not remove
	// repositories. This means we need to use the store as a fallback Source
	// in the face of those kinds of errors, so that the diff results in Unmodified
	// entries. This logic can live here. We only need to make the returned error
	// more structured so we can identify which sources failed and for what reason.
	// See the SyncError type defined in other_external_services.go for inspiration.
	var sourced Repos
	if sourced, err = s.sourceRepos(ctx); err != nil {
		log15.Error("Syncer", "sourceRepos", err)
	}

	log15.Info("Syncer", "sourced", sourced.IDs(), "err", err)

	store := s.store
	if tr, ok := s.store.(Transactor); ok {
		var txs TxStore
		if txs, err = tr.Transact(ctx); err != nil {
			return err
		}
		defer txs.Done(&err)
		store = txs
	}

	var stored Repos
	if stored, err = store.ListRepos(ctx, s.sourceNames()...); err != nil {
		return err
	}

	diff := s.diff(sourced, stored)
	upserts := s.upserts(diff)

	if err = store.UpsertRepos(ctx, upserts...); err != nil {
		return err
	}

	s.diffs <- diff
	return nil
}

func (s Syncer) upserts(diff Diff) []*Repo {
	now := s.now()
	upserts := make([]*Repo, 0, len(diff.Added)+len(diff.Deleted)+len(diff.Modified))

	pp.Printf("diff: %s", diff)

	for _, add := range diff.Added {
		repo := add.(*Repo)
		repo.CreatedAt, repo.UpdatedAt = now, now
		upserts = append(upserts, repo)
	}

	for _, mod := range diff.Modified {
		repo := mod.(*Repo)
		repo.UpdatedAt, repo.DeletedAt = now, time.Time{}
		upserts = append(upserts, repo)
	}

	for _, del := range diff.Deleted {
		repo := del.(*Repo)
		repo.UpdatedAt, repo.DeletedAt = now, now
		upserts = append(upserts, repo)
	}

	pp.Printf("\nupserts: %s", upserts)

	return upserts
}

func (Syncer) diff(sourced, stored []*Repo) Diff {
	before := make([]Diffable, len(stored))
	for i := range stored {
		before[i] = stored[i]
	}

	after := make([]Diffable, len(sourced))
	for i := range sourced {
		after[i] = sourced[i]
	}

	return NewDiff(before, after, func(before, after Diffable) bool {
		// This modified function returns true iff any fields in `after` changed
		// in comparison to `before` for which the `Source` is authoritative.
		b, a := before.(*Repo), after.(*Repo)
		return b.Name != a.Name ||
			b.Language != a.Language ||
			b.Fork != a.Fork ||
			b.Archived != a.Archived ||
			b.Description != a.Description
	})
}

func (s Syncer) sourceRepos(ctx context.Context) ([]*Repo, error) {
	type result struct {
		src   Source
		repos []*Repo
		err   error
	}

	ch := make(chan result, len(s.sources))
	for _, src := range s.sources {
		go func(src Source) {
			if repos, err := src.ListRepos(ctx); err != nil {
				ch <- result{src: src, err: err}
			} else {
				ch <- result{src: src, repos: repos}
			}
		}(src)
	}

	var repos []*Repo
	var err *multierror.Error
	for i := 0; i < cap(ch); i++ {
		if r := <-ch; r.err != nil {
			err = multierror.Append(err, r.err)
		} else {
			repos = append(repos, r.repos...)
		}
	}

	return repos, err.ErrorOrNil()
}

func (s Syncer) sourceNames() []string {
	names := make([]string, 0, len(s.sources))
	for name := range s.sources {
		names = append(names, name)
	}
	return names
}