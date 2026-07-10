import { posix } from 'node:path';
import { PermissionError } from '@mastra/core/workspace';

export function normalizeWorkspacePath(input: string): string {
  if (input.includes('\0')) {
    throw new PermissionError(input, 'access');
  }

  const portableInput = input.replaceAll('\\', '/');
  if (portableInput.split('/').includes('..')) {
    throw new PermissionError(input, 'access');
  }

  const withLeadingSlash = portableInput.startsWith('/') ? portableInput : `/${portableInput}`;
  const normalized = posix.normalize(withLeadingSlash);

  if (normalized === '/..' || normalized.startsWith('/../')) {
    throw new PermissionError(input, 'access');
  }

  return normalized;
}

export function workspacePathParts(input: string) {
  const path = normalizeWorkspacePath(input);

  return {
    path,
    name: path === '/' ? '' : posix.basename(path),
    parentPath: path === '/' ? '/' : posix.dirname(path),
  };
}

export function isDescendantPath(candidate: string, directory: string): boolean {
  const normalizedCandidate = normalizeWorkspacePath(candidate);
  const normalizedDirectory = normalizeWorkspacePath(directory);

  return normalizedDirectory === '/'
    ? normalizedCandidate !== '/'
    : normalizedCandidate.startsWith(`${normalizedDirectory}/`);
}
