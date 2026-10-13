/** Checks if a string is a SHA-1 or SHA-256 Git object id */
export function isGitCommitId(value: string | undefined): value is string {
  return !!value && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}
