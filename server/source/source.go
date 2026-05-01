package source

import "walkthrough-server/store"

// WalkthroughSource provides access to walkthrough content.
type WalkthroughSource interface {
	// List returns metadata for all available walkthroughs.
	List() ([]store.WalkthroughMeta, error)
	// Get returns the raw JSON content for a walkthrough by its ID.
	Get(id string) ([]byte, error)
}
