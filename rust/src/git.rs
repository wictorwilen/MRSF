//! Git is an optional evidence source, never a runtime bridge to another MRSF
//! implementation. Every invocation uses argument arrays (no shell), drains both
//! pipes concurrently, and kills/reaps the child after ten seconds. An absent
//! executable returns `None`; invalid revisions and other real failures are errors.
use crate::{DiffHunk, Error, Result};
use std::{
    ffi::OsString,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, OnceLock},
    thread,
    time::{Duration, Instant},
};

const TIMEOUT: Duration = Duration::from_secs(10);
type ProcessOutput = (bool, Vec<u8>, Vec<u8>);

// Each reader owns its pipe, so it remains memory-safe even if it briefly
// outlives a timed-out invocation. Do not join these threads without a deadline:
// a Git subprocess (for example a partial-clone fetch) can inherit a pipe and
// keep it open after the main Git process has exited or been killed.
fn read_pipe(pipe: impl Read + Send + 'static) -> mpsc::Receiver<std::io::Result<Vec<u8>>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut pipe = pipe;
        let mut bytes = Vec::new();
        let result = pipe.read_to_end(&mut bytes).map(|_| bytes);
        // A timeout drops the receiver. Its failed send is then expected, not
        // a reason to panic in a background reader.
        let _ = sender.send(result);
    });
    receiver
}

fn receive_pipe(
    receiver: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    started: Instant,
) -> Result<Vec<u8>> {
    match receiver.recv_timeout(TIMEOUT.saturating_sub(started.elapsed())) {
        Ok(result) => Ok(result?),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(Error::GitTimeout),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(Error::Git("output reader stopped unexpectedly".into()))
        }
    }
}

/// Configurable executable mainly for embedded environments and deterministic
/// missing-Git tests. Application input is never interpreted by a shell.
#[derive(Clone, Debug)]
pub struct Git {
    executable: OsString,
}

impl Default for Git {
    fn default() -> Self {
        Self::new("git")
    }
}

impl Git {
    pub fn new(executable: impl Into<OsString>) -> Self {
        Self {
            executable: executable.into(),
        }
    }

    fn output(&self, cwd: &Path, args: &[&str]) -> Result<Option<ProcessOutput>> {
        // A missing working directory also yields NotFound from spawn; check
        // it separately so it is not misreported as a missing Git executable.
        if !std::fs::metadata(cwd)?.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotADirectory,
                "Git working directory is not a directory",
            )
            .into());
        }
        let mut child = match Command::new(&self.executable)
            .current_dir(cwd)
            // Empty GIT_PAGER disables paging without launching even a "cat"
            // helper. Prompts must never make this synchronous library wait for
            // terminal input when embedded in an editor or unattended service.
            .env("GIT_PAGER", "")
            .env("GIT_TERMINAL_PROMPT", "0")
            // Repository discovery recognizes Git's "not a git repository"
            // diagnostic. Make that subprocess output locale-independent
            // without modifying the embedding application's environment.
            .env("LC_ALL", "C")
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        // Reading after wait can deadlock when Git fills a pipe. Dedicated
        // readers consume both streams while this thread enforces the deadline.
        let started = Instant::now();
        let out = read_pipe(child.stdout.take().expect("piped stdout"));
        let err = read_pipe(child.stderr.take().expect("piped stderr"));
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) if started.elapsed() < TIMEOUT => thread::sleep(Duration::from_millis(10)),
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(Error::GitTimeout);
                }
                Err(e) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(Error::Io(e));
                }
            }
        };
        let status = status?;
        // Both pipes share the process deadline; neither gets an additional
        // ten-second allowance after process completion.
        let stdout = receive_pipe(out, started)?;
        let stderr = receive_pipe(err, started)?;
        Ok(Some((status.success(), stdout, stderr)))
    }

    /// Execute a read-only Git operation. `None` means Git is absent.
    fn text(&self, cwd: &Path, args: &[&str]) -> Result<Option<String>> {
        let Some((success, stdout, stderr)) = self.output(cwd, args)? else {
            return Ok(None);
        };
        if !success {
            return Err(Error::Git(String::from_utf8_lossy(&stderr).trim().into()));
        }
        String::from_utf8(stdout)
            .map(Some)
            .map_err(|e| Error::Git(format!("non-UTF-8 Git output: {e}")))
    }

    pub fn available(&self) -> Result<bool> {
        Ok(self
            .text(&std::env::current_dir()?, &["--version"])?
            .is_some())
    }

    pub fn find_repo_root(&self, cwd: impl AsRef<Path>) -> Result<Option<PathBuf>> {
        let Some((success, stdout, stderr)) =
            self.output(cwd.as_ref(), &["rev-parse", "--show-toplevel"])?
        else {
            return Ok(None);
        };
        if !success {
            let message = String::from_utf8_lossy(&stderr);
            if message.contains("not a git repository") {
                return Ok(None);
            }
            return Err(Error::Git(message.trim().into()));
        }
        Ok(Some(PathBuf::from(String::from_utf8_lossy(&stdout).trim())))
    }

    pub fn current_commit(&self, root: impl AsRef<Path>) -> Result<Option<String>> {
        Ok(self
            .text(root.as_ref(), &["rev-parse", "--verify", "HEAD"])?
            .map(|s| s.trim().into()))
    }

    pub fn resolve_commit(&self, revision: &str, root: impl AsRef<Path>) -> Result<Option<String>> {
        // --end-of-options prevents untrusted revision names becoming flags.
        Ok(self
            .text(
                root.as_ref(),
                &[
                    "rev-parse",
                    "--verify",
                    "--end-of-options",
                    &format!("{revision}^{{commit}}"),
                ],
            )?
            .map(|s| s.trim().into()))
    }

    pub fn file_at_commit(
        &self,
        commit: &str,
        file: &str,
        root: impl AsRef<Path>,
    ) -> Result<Option<String>> {
        crate::safe_relative_path(file)?;
        let Some(canonical) = self.resolve_commit(commit, &root)? else {
            return Ok(None);
        };
        self.text(
            root.as_ref(),
            &["show", &format!("{canonical}:{}", file.replace('\\', "/"))],
        )
    }

    /// `to == None` compares the source commit with the current working tree,
    /// including unstaged edits rather than accidentally comparing HEAD only.
    pub fn diff(
        &self,
        from: &str,
        to: Option<&str>,
        file: &str,
        root: impl AsRef<Path>,
    ) -> Result<Option<Vec<DiffHunk>>> {
        crate::safe_relative_path(file)?;
        let Some(from) = self.resolve_commit(from, &root)? else {
            return Ok(None);
        };
        let to = to
            .map(|r| self.resolve_commit(r, &root))
            .transpose()?
            .flatten();
        let mut args = vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--unified=0",
            "--no-color",
            from.as_str(),
        ];
        if let Some(to) = &to {
            args.push(to);
        }
        args.extend(["--", file]);
        Ok(self
            .text(root.as_ref(), &args)?
            .map(|s| parse_diff_hunks(&s)))
    }

    pub fn user_name(&self, root: impl AsRef<Path>) -> Result<Option<String>> {
        let Some((success, stdout, stderr)) =
            self.output(root.as_ref(), &["config", "--local", "--get", "user.name"])?
        else {
            return Ok(None);
        };
        if !success {
            if stderr.is_empty() {
                return Ok(None);
            }
            return Err(Error::Git(String::from_utf8_lossy(&stderr).into()));
        }
        Ok(Some(String::from_utf8_lossy(&stdout).trim().into()))
    }

    pub fn staged_files(&self, root: impl AsRef<Path>) -> Result<Option<Vec<PathBuf>>> {
        let Some(text) = self.text(
            root.as_ref(),
            &["diff", "--cached", "--name-only", "-z", "--diff-filter=d"],
        )?
        else {
            return Ok(None);
        };
        Ok(Some(
            text.split('\0')
                .filter(|p| !p.is_empty())
                .map(PathBuf::from)
                .collect(),
        ))
    }
}

/// Default executable availability is cached; operation errors remain explicit.
pub fn is_git_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| Git::default().available().unwrap_or(false))
}

pub fn find_repo_root(cwd: impl AsRef<Path>) -> Result<Option<PathBuf>> {
    Git::default().find_repo_root(cwd)
}
pub fn get_current_commit(root: impl AsRef<Path>) -> Result<Option<String>> {
    Git::default().current_commit(root)
}
pub fn resolve_commit(revision: &str, root: impl AsRef<Path>) -> Result<Option<String>> {
    Git::default().resolve_commit(revision, root)
}
pub fn get_file_at_commit(
    commit: &str,
    file: &str,
    root: impl AsRef<Path>,
) -> Result<Option<String>> {
    Git::default().file_at_commit(commit, file, root)
}
pub fn get_diff(
    from: &str,
    to: Option<&str>,
    file: &str,
    root: impl AsRef<Path>,
) -> Result<Option<Vec<DiffHunk>>> {
    Git::default().diff(from, to, file, root)
}

pub fn parse_diff_hunks(text: &str) -> Vec<DiffHunk> {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@")
            .expect("constant regex")
    });
    let mut result: Vec<DiffHunk> = Vec::new();
    for line in text.lines() {
        if let Some(c) = re.captures(line) {
            let parse = |i, default| {
                c.get(i)
                    .and_then(|v| v.as_str().parse().ok())
                    .unwrap_or(default)
            };
            result.push(DiffHunk {
                old_start: parse(1, 0),
                old_count: parse(2, 1),
                new_start: parse(3, 0),
                new_count: parse(4, 1),
                lines: Vec::new(),
            });
        } else if line.starts_with(['+', '-', ' ']) {
            if let Some(h) = result.last_mut() {
                h.lines.push(line.into());
            }
        }
    }
    result
}

/// Return cumulative displacement and whether the original line was modified.
/// A zero-length insertion at old_start occurs *after* that source line.
pub fn get_line_shift(hunks: &[DiffHunk], line: usize) -> (isize, bool) {
    let mut shift = 0;
    for h in hunks {
        if h.old_start > line {
            break;
        }
        if h.old_count > 0 && line < h.old_start + h.old_count {
            return (shift, true);
        }
        if h.old_count == 0 && h.old_start == line {
            continue;
        }
        if h.old_start + h.old_count <= line {
            shift += h.new_count as isize - h.old_count as isize;
        }
    }

    (shift, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Only the subprocess test invokes this ignored helper. Reusing the test
    // executable avoids shell scripts and platform-specific sleep programs.
    #[test]
    #[ignore = "subprocess fixture for enforces_ten_second_deadline"]
    fn sleeping_child() {
        thread::sleep(Duration::from_secs(30));
    }

    #[test]
    fn enforces_ten_second_deadline() {
        let executable = std::env::current_exe().unwrap();
        let git = Git::new(executable.into_os_string());
        let start = Instant::now();
        let result = git.output(
            &std::env::current_dir().unwrap(),
            &[
                "--exact",
                "git::tests::sleeping_child",
                "--ignored",
                "--nocapture",
            ],
        );
        assert!(matches!(result, Err(Error::GitTimeout)), "{result:?}");
        assert!(start.elapsed() >= TIMEOUT);
        assert!(start.elapsed() < Duration::from_secs(20));
    }

    #[test]
    fn inherited_pipe_cannot_extend_the_process_deadline() {
        let (sender, receiver) = mpsc::channel();
        // Keep a sender alive to model a descendant holding an inherited pipe.
        // Starting at the already-expired deadline makes this regression test
        // deterministic without a second ten-second subprocess.
        let started = Instant::now() - TIMEOUT;
        assert!(matches!(
            receive_pipe(receiver, started),
            Err(Error::GitTimeout)
        ));
        drop(sender);
    }
}
