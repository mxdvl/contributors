use num_format::{Locale, ToFormattedString};
use regex::Regex;
use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();
    // default to current directory
    let path = args.get(1).map(|s| s.as_str()).unwrap_or(".");

    let repo_path = find_repo_root(path)?;
    println!("Analyzing repo at {:?}", repo_path);

    // FIXME: is there a better way to do this?
    let regexes = build_regexes()?;

    // TODO: sort by count descending
    let mut authors: HashMap<String, u64> = HashMap::new();
    let mut total = 1u64;

    // Get list of tracked files using git ls-files
    let tracked_files = get_tracked_files(&repo_path)?;

    // TODO: this can be slow, notify of work in progress
    for file_path in tracked_files {
        if !matches_any(&file_path, &regexes) {
            continue;
        }

        // Run git blame with -M flag (track copies/moves)
        let blame_output = run_git_blame(&repo_path, &file_path)?;

        // Parse blame output to extract author names
        let file_authors = parse_git_blame_porcelain(&blame_output);
        for (name, count) in file_authors {
            // TODO: handle .mailmap files or other substitutions
            *authors.entry(name).or_default() += count;
            total += count;
        }
    }

    println!("Total lines: {}", total.to_formatted_string(&Locale::en));

    for (name, count) in authors {
        let pct = 100.0 * (count as f64) / (total as f64);
        println!("{pct:.1}%\t{name}");
    }
    Ok(())
}

/// Find the git repository root directory
fn find_repo_root(path: &str) -> anyhow::Result<PathBuf> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()?;

    if !output.status.success() {
        anyhow::bail!("Not a git repository (or any parent up to mount point)");
    }

    let repo_path = String::from_utf8(output.stdout)?.trim().to_string();
    Ok(PathBuf::from(repo_path))
}

/// Get list of tracked files in the repository
fn get_tracked_files(repo_path: &Path) -> anyhow::Result<Vec<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("ls-files")
        .output()?;

    if !output.status.success() {
        anyhow::bail!("Failed to list tracked files");
    }

    let files = String::from_utf8(output.stdout)?
        .lines()
        .map(|s| s.to_string())
        .collect();

    Ok(files)
}

/// Run git blame on a file and return the output
fn run_git_blame(repo_path: &Path, file_path: &str) -> anyhow::Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("blame")
        .arg("-M") // Track copies and moves within same commit
        .arg("--line-porcelain") // Machine-readable format
        .arg("--")
        .arg(file_path)
        .stderr(Stdio::null())
        .output()?;

    if !output.status.success() {
        // Some files might not be blameable, skip them
        return Ok(String::new());
    }

    Ok(String::from_utf8(output.stdout)?)
}

/// Parse git blame porcelain format output to extract author names and line counts
fn parse_git_blame_porcelain(blame_output: &str) -> HashMap<String, u64> {
    let mut authors: HashMap<String, u64> = HashMap::new();
    let mut current_author = String::from("Unknown");

    for line in blame_output.lines() {
        if line.starts_with("author ") {
            current_author = line
                .strip_prefix("author ")
                .unwrap_or("Unknown")
                .to_string();
        } else if line.starts_with('\t') {
            // This is an actual line of code, count it for the current author
            *authors.entry(current_author.clone()).or_default() += 1;
        }
    }

    authors
}

/// Compile a list of regexes at startup
fn build_regexes() -> anyhow::Result<Vec<Regex>> {
    let patterns = [
        // TODO: make this list dynamic
        r"\.rs$",
        r"\.m?[jt]sx?$",
        r"\.py$",
    ];

    let regexes = patterns
        .iter()
        .map(|p| Regex::new(p))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(regexes)
}

fn matches_any(file: &str, regexes: &[Regex]) -> bool {
    regexes.iter().any(|re| re.is_match(file))
}
