import * as vscode from 'vscode';
import type { DependencyResolver } from './dependencyResolver';

let dependencyResolver: DependencyResolver | null = null;

export function setDependencyResolver(resolver: DependencyResolver | null): void {
    dependencyResolver = resolver;
}

const UNRESOLVABLE_PREFIXES = ['java.', 'javax.', 'sun.', 'com.sun.', 'jdk.'];

const PRIMITIVE_ARRAYS = new Set([
    'byte[]', 'short[]', 'int[]', 'long[]',
    'float[]', 'double[]', 'char[]', 'boolean[]'
]);

/**
 * Resolves a Java class name to a .java file URI in the workspace.
 * Returns null for JDK classes, primitives, or classes not found in the workspace.
 */
export async function resolveSource(className: string): Promise<vscode.Uri | null> {
    if (!className) {
        return null;
    }

    // Skip primitive arrays
    if (PRIMITIVE_ARRAYS.has(className)) {
        return null;
    }

    // Skip object arrays of primitives (e.g., "byte[][]")
    if (className.endsWith('[]') && PRIMITIVE_ARRAYS.has(className.replace(/\[\]$/, ''))) {
        return null;
    }

    // Skip JDK classes
    for (const prefix of UNRESOLVABLE_PREFIXES) {
        if (className.startsWith(prefix)) {
            return null;
        }
    }

    // Strip array suffix (e.g., "com.example.Foo[]" → "com.example.Foo")
    const baseClass = className.replace(/\[\]$/, '');

    // Strip inner class (e.g., "com.example.Outer$Inner" → "com.example.Outer")
    const outerClass = baseClass.includes('$') ? baseClass.substring(0, baseClass.indexOf('$')) : baseClass;

    // Extract simple class name (e.g., "com.example.UserService" → "UserService")
    const parts = outerClass.split('.');
    const simpleName = parts[parts.length - 1];

    if (!simpleName) {
        return null;
    }

    // Build package path segments for disambiguation (e.g., ["com", "example"])
    const packageParts = parts.slice(0, -1);

    const glob = `**/${simpleName}.java`;
    const files = await vscode.workspace.findFiles(glob, '**/node_modules/**', 5);

    if (files.length === 0) {
        // Tier 2: check dependency source JARs
        if (dependencyResolver) {
            return dependencyResolver.resolveFromDependencies(className);
        }
        return null;
    }

    if (files.length === 1) {
        return files[0];
    }

    // Disambiguate: prefer the file whose path contains the package segments
    if (packageParts.length > 0) {
        const packagePath = packageParts.join('/');
        const match = files.find(f => f.fsPath.includes(packagePath));
        if (match) {
            return match;
        }
    }

    // Fallback: return first match
    return files[0];
}
