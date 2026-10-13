/** Replaces commit metadata and the discovery tags owned by that metadata */
export function replaceGitCommitReferences(tags: string[][], name: string, commits: string[]): string[][] {
  const old = new Set(tags.filter((tag) => tag[0] === name).flatMap((tag) => tag.slice(1)));
  const next = tags.filter((tag) => tag[0] !== name);
  // Each generated role owns one discovery tag; the same id may also identify the repository.
  for (const commit of old) {
    for (let index = next.length - 1; index >= 0; index--) {
      if (next[index][0] === "r" && next[index][1] === commit) {
        next.splice(index, 1);
        break;
      }
    }
  }
  const ids = [...new Set(commits)];
  return [...next, ...(ids.length ? [[name, ...ids], ...ids.map((id) => ["r", id])] : [])];
}
