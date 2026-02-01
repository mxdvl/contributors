#!/usr/bin/env -S deno run --allow-run --allow-read

/**
 * Contributors analyzer - Deno + TypeScript version
 * Analyzes git repository to show code authorship by lines
 */

interface AuthorStats {
  [author: string]: number;
}

/**
 * File extensions to include in the analysis
 */
const FILE_PATTERNS = [
  /\.rs$/,
  /\.m?[jt]sx?$/,
  /\.py$/,
];

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
  return num.toLocaleString("en-US");
}

/**
 * Main function
 */
async function main() {
  const args = Deno.args;
  const repoPath = args[0] || ".";

  // Verify it's a git repository
  try {
    await runGitCommand(["rev-parse", "--git-dir"], repoPath);
  } catch (error) {
    console.error(`Error: Not a git repository: ${repoPath}`);
    Deno.exit(1);
  }

  console.log(`Analyzing repo at ${repoPath}`);

  const authors: AuthorStats = {};
  let total = 1; // Start at 1 to match Rust version

  // Get all tracked files
  const files = await getTrackedFiles(repoPath);
  const filteredFiles = files.filter(matchesAnyPattern);

  // Process each file
  for (const file of filteredFiles) {
    const blameData = await getBlameForFile(repoPath, file);

    for (const [author, lineCount] of blameData.entries()) {
      authors[author] = (authors[author] || 0) + lineCount;
      total += lineCount;
    }
  }

  console.log(`Total lines: ${formatNumber(total)}`);

  // Print results
  for (const [name, count] of Object.entries(authors)) {
    const pct = (100.0 * count) / total;
    console.log(`${pct.toFixed(1)}%\t${name}`);
  }
}

// Run main function
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    Deno.exit(1);
  }
}
