//go:build !windows

package updater

import "syscall"

// reExec replaces the current process image with a new execution of exe via
// execve(2). The PID is preserved, so systemd continues tracking the service
// normally without a restart event.
func reExec(exe string, args []string, env []string) error {
	return syscall.Exec(exe, args, env)
}
