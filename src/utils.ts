import * as path from 'path';

export function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Normalizes path separators to forward slashes.
 * @param pathToNormalize The path string to normalize.
 * @returns Normalized path string or an empty string if input is invalid.
 */
export function normalizePath(pathToNormalize: string): string {
    if (typeof pathToNormalize !== 'string' || !pathToNormalize) return '';
    return pathToNormalize.replace(/\\/g, '/');
}

/**
 * Ensures a path segment is absolute. If relative, resolves against workspacePath.
 * If already absolute, it's returned. If empty or undefined, returns resolved workspacePath.
 * @param pathSegment The path segment to make absolute.
 * @param workspacePath The workspace path to resolve against if pathSegment is relative.
 * @returns An absolute path.
 */
export function ensureAbsolute(pathSegment: string, workspacePath: string): string {
    if (typeof pathSegment !== 'string' || !pathSegment) {
        // Resolve an empty segment against workspacePath, effectively returning workspacePath
        return path.resolve(workspacePath, '');
    }
    if (path.isAbsolute(pathSegment)) {
        return pathSegment;
    }
    return path.resolve(workspacePath, pathSegment);
}