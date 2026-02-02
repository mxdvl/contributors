#!/usr/bin/env -S deno run --allow-run --allow-read

/**
 * File extensions to include in the analysis
 * Matches: C#, JavaScript, Python and Rust files
 */
const FILE_PATTERNS = [
  /\.cs$/,
  /\.m?[jt]sx?$/, // Matches .js, .jsx, .ts, .tsx, .mjs, .mts
  /\.py$/,
  /\.rs$/,
];

if (!import.meta.main) {
  console.error("This file is not meant to be imported!");
  Deno.exit(1);
}

const [path = "."] = Deno.args;

// Verify it's a git repository
try {
  await runGitCommand(["rev-parse", "--git-dir"], path);
} catch (error) {
  console.error(`Error: Not a git repository: ${path}`);
  Deno.exit(1);
}

console.log(`Analyzing repo at ${path}`);

const authors = new Map<string, number>();

// Get all tracked files
const files = await getTrackedFiles(path);
const filteredFiles = files.filter(matchesAnyPattern);

// Process each file
for (const file of filteredFiles) {
  const blameData = await getBlameForFile(path, file);

  for (const [author, lineCount] of blameData.entries()) {
    const count = authors.get(author) ?? 0;
    authors.set(author, count + lineCount);
  }
}

const sorted = [...authors.entries()].sort(([, a], [, b]) => b - a);
const total = sorted.reduce((accumulator, [, next]) => accumulator + next, 1);

console.log(`Total lines: ${formatNumber(total)}`);

// Print results
for (const [name, count] of sorted) {
  const percentage = (100.0 * count) / total;
  if (percentage < 1 / 1200) continue;
  console.log(`${percentage.toFixed(1)}%\t${name}`);
}

/**
 * Check if a file path matches any of the patterns
 */
function matchesAnyPattern(filePath: string): boolean {
  return FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Execute a git command and return stdout
 */
async function runGitCommand(args: string[], cwd: string): Promise<string> {
  const command = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorMessage = new TextDecoder().decode(stderr);
    throw new Error(`Git command failed: ${errorMessage}`);
  }

  return new TextDecoder().decode(stdout);
}

/**
 * Get all tracked files in the repository
 */
async function getTrackedFiles(repoPath: string): Promise<string[]> {
  const output = await runGitCommand(["ls-files"], repoPath);
  return output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
}

/**
 * Get blame information for a file
 */
async function getBlameForFile(
  repoPath: string,
  filePath: string,
): Promise<Map<string, number>> {
  try {
    // Use git blame with -M option (similar to track_copies_same_commit_moves)
    // -w ignores whitespace, --line-porcelain gives detailed output
    const output = await runGitCommand(
      ["blame", "-M", "--line-porcelain", filePath],
      repoPath,
    );

    const authorCounts = new Map<string, number>();
    const lines = output.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Look for author lines in porcelain format
      if (line.startsWith("author ")) {
        const author = line.substring(7); // Remove "author " prefix
        authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
      }
    }

    return authorCounts;
  } catch (error) {
    // If blame fails (e.g., binary file), return empty map
    console.error(`Warning: Could not blame ${filePath}: ${error.message}`);
    return new Map();
  }
}

/**
 * Format a number with thousands separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString("en-GB");
}
