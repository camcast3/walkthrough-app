// Package updater provides in-place binary self-update via GitHub Releases.
// It checks for a newer release, downloads the platform binary and static
// assets, atomically replaces them on disk, then re-execs the process so the
// running service continues under the new binary without any manual steps.
package updater

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const githubAPIBase = "https://api.github.com"

// UpdateInfo describes the result of a version check.
type UpdateInfo struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	ReleaseURL      string `json:"releaseUrl"`
	ReleaseNotes    string `json:"releaseNotes"`
}

// Updater handles checking for and applying binary self-updates.
type Updater struct {
	// Repo is the GitHub repository in "owner/repo" format.
	Repo string
	// BinaryPath is the absolute path to the running server binary.
	BinaryPath string
	// StaticDir is the absolute path to the static webapp files directory.
	StaticDir  string
	httpClient *http.Client
}

// New creates an Updater for repo. BinaryPath is resolved via os.Executable().
func New(repo, staticDir string) (*Updater, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("resolve executable path: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return nil, fmt.Errorf("eval symlinks: %w", err)
	}
	return &Updater{
		Repo:       repo,
		BinaryPath: exe,
		StaticDir:  filepath.Clean(staticDir),
		httpClient: &http.Client{Timeout: 5 * time.Minute},
	}, nil
}

// Check fetches the latest GitHub release and compares it to currentVersion.
// Returns an UpdateInfo regardless of whether an update is available.
func (u *Updater) Check(ctx context.Context, currentVersion string) (*UpdateInfo, error) {
	release, err := u.fetchLatestRelease(ctx)
	if err != nil {
		return nil, err
	}
	return &UpdateInfo{
		CurrentVersion:  currentVersion,
		LatestVersion:   release.TagName,
		UpdateAvailable: release.TagName != currentVersion && currentVersion != "dev",
		ReleaseURL:      release.HTMLURL,
		ReleaseNotes:    release.Body,
	}, nil
}

// Apply downloads the latest release binary and static files, replaces them
// on disk, then re-execs this process. On success, Apply does not return —
// the process is replaced by the new binary. On failure, it returns an error.
func (u *Updater) Apply(ctx context.Context) error {
	release, err := u.fetchLatestRelease(ctx)
	if err != nil {
		return fmt.Errorf("fetch release: %w", err)
	}

	assetName := platformBinaryName()
	var binaryURL, staticURL string
	for _, a := range release.Assets {
		switch a.Name {
		case assetName:
			binaryURL = a.BrowserDownloadURL
		case "static.tar.gz":
			staticURL = a.BrowserDownloadURL
		}
	}

	if binaryURL == "" {
		return fmt.Errorf("release %s has no asset %q — is CI publishing binaries?", release.TagName, assetName)
	}

	// Download the new binary to a temp file next to the current one.
	// Same directory guarantees the rename is atomic (same filesystem).
	binaryDir := filepath.Dir(u.BinaryPath)
	tmpBin, err := os.CreateTemp(binaryDir, ".walkthrough-server-new-*")
	if err != nil {
		return fmt.Errorf("create temp file in %s: %w", binaryDir, err)
	}
	tmpBinPath := tmpBin.Name()
	cleanupTemp := true
	defer func() {
		tmpBin.Close()
		if cleanupTemp {
			os.Remove(tmpBinPath)
		}
	}()

	log.Printf("[updater] downloading binary %s from %s", assetName, binaryURL)
	if err := u.downloadTo(ctx, binaryURL, tmpBin); err != nil {
		return fmt.Errorf("download binary: %w", err)
	}
	tmpBin.Close()

	if err := os.Chmod(tmpBinPath, 0755); err != nil {
		return fmt.Errorf("chmod binary: %w", err)
	}

	// Update static files — non-fatal so a binary update still proceeds.
	if staticURL != "" {
		log.Printf("[updater] downloading static files from %s", staticURL)
		if err := u.replaceStaticDir(ctx, staticURL); err != nil {
			log.Printf("[updater] static update failed (binary update continues): %v", err)
		}
	}

	// Atomically replace the running binary.
	log.Printf("[updater] installing %s → %s", tmpBinPath, u.BinaryPath)
	if err := os.Rename(tmpBinPath, u.BinaryPath); err != nil {
		return fmt.Errorf("replace binary: %w", err)
	}
	cleanupTemp = false // renamed, temp path no longer exists

	// Re-exec this process with the new binary image.
	log.Printf("[updater] restarting with new binary (%s)", release.TagName)
	return reExec(u.BinaryPath, os.Args, os.Environ())
}

// replaceStaticDir downloads static.tar.gz and atomically swaps the static dir.
func (u *Updater) replaceStaticDir(ctx context.Context, url string) error {
	resp, err := u.doGet(ctx, url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	newDir := u.StaticDir + ".new"
	_ = os.RemoveAll(newDir)

	gr, err := gzip.NewReader(resp.Body)
	if err != nil {
		return fmt.Errorf("gzip reader: %w", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar: %w", err)
		}

		// Guard against path traversal attacks in the archive.
		target := filepath.Join(newDir, filepath.Clean("/"+hdr.Name))
		if !strings.HasPrefix(target, filepath.Clean(newDir)+string(os.PathSeparator)) {
			return fmt.Errorf("tar: unsafe path %q", hdr.Name)
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(hdr.Mode)&0755)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(f, tr)
			f.Close()
			if copyErr != nil {
				return copyErr
			}
		}
	}

	// Atomically swap: old → .old, new → current, then remove .old.
	oldDir := u.StaticDir + ".old"
	_ = os.RemoveAll(oldDir)
	if err := os.Rename(u.StaticDir, oldDir); err != nil {
		_ = os.RemoveAll(newDir)
		return fmt.Errorf("archive old static dir: %w", err)
	}
	if err := os.Rename(newDir, u.StaticDir); err != nil {
		_ = os.Rename(oldDir, u.StaticDir) // restore on failure
		return fmt.Errorf("install new static dir: %w", err)
	}
	_ = os.RemoveAll(oldDir)
	return nil
}

func (u *Updater) fetchLatestRelease(ctx context.Context) (*githubRelease, error) {
	url := fmt.Sprintf("%s/repos/%s/releases/latest", githubAPIBase, u.Repo)
	resp, err := u.doGet(ctx, url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var rel githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("decode release: %w", err)
	}
	return &rel, nil
}

func (u *Updater) doGet(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "walkthrough-server-updater/1")

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s: HTTP %d", url, resp.StatusCode)
	}
	return resp, nil
}

func (u *Updater) downloadTo(ctx context.Context, url string, dst io.Writer) error {
	resp, err := u.doGet(ctx, url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, err = io.Copy(dst, resp.Body)
	return err
}

// platformBinaryName returns the expected release asset name for the current platform.
func platformBinaryName() string {
	name := fmt.Sprintf("walkthrough-server-%s-%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name
}

type githubRelease struct {
	TagName string               `json:"tag_name"`
	Body    string               `json:"body"`
	HTMLURL string               `json:"html_url"`
	Assets  []githubReleaseAsset `json:"assets"`
}

type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}
