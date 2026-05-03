//go:build windows

package updater

import (
	"os"
	"os/exec"
)

// reExec on Windows starts a new detached process and exits the current one.
// The update is applied before this is called, so the new executable at exe
// is the updated binary. The caller (or a service manager) is responsible for
// noting that the original process exited.
func reExec(exe string, args []string, env []string) error {
	cmd := exec.Command(exe, args[1:]...)
	cmd.Env = env
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	os.Exit(0)
	return nil // unreachable
}
