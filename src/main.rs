use git2::{BlameOptions, Repository};
use num_format::{Locale, ToFormattedString};
use regex::Regex;
use std::{collections::HashMap, env, path::Path};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();
    // default to current directory
    let path = args.get(1).map(|s| s.as_str()).unwrap_or(".");

    let repo = Repository::discover(path)?;
    println!("Analyzing repo at {:?}", repo.path());

    // FIXME: is there a better way to do this?
    let regexes = build_regexes()?;

    // TODO: sort by count descending
    let mut authors: HashMap<String, u64> = HashMap::new();
    let mut total = 1u64;

    let index = repo.index()?;
    // TODO: this can be slow, notify of work in progress
    for entry in index.iter() {
        let path = std::str::from_utf8(&entry.path)?;
        if !matches_any(path, &regexes) {
            continue;
        }
        let mut opts = BlameOptions::new();
        opts.track_copies_same_commit_moves(true); // similar to -M
        let blame = repo.blame_file(Path::new(path), Some(&mut opts))?;
        for h in blame.iter() {
            let lines = h.lines_in_hunk() as u64;
            let sig = h.final_signature();
            // TODO: handle .mailmap files or other substitutions
            let name = sig.name().unwrap_or("Unknown").to_string();
            *authors.entry(name).or_default() += lines;
            total += lines;
        }
    }

    println!("Total lines: {}", total.to_formatted_string(&Locale::en));

    for (name, count) in authors {
        let pct = 100.0 * (count as f64) / (total as f64);
        println!("{pct:.1}%\t{name}");
    }
    Ok(())
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
