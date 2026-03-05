/**
 * Maps raw error messages to user-friendly, actionable messages.
 * Patterns are checked in order; first match wins.
 * Add new patterns to the array without editing existing ones (open/closed).
 */

interface ErrorPattern {
    pattern: RegExp;
    message: string;
}

const errorPatterns: ErrorPattern[] = [
    {
        pattern: /timed?\s*out/i,
        message: 'The analysis server is not responding. The heap dump may be too large, or the server may have crashed. Try restarting VS Code.'
    },
    {
        pattern: /ENOENT|not found|no such file/i,
        message: 'The analysis server binary was not found. Build it with: cd hprof-analyzer && cargo build --release'
    },
    {
        pattern: /shutdown|Client is shutdown/i,
        message: 'The analysis server has shut down unexpectedly. Try reopening the file.'
    },
    {
        pattern: /Failed to (parse|load|build heap graph|read)/i,
        message: 'The HPROF file could not be parsed. It may be corrupted or in an unsupported format.'
    },
    {
        pattern: /out of memory|OOM|Cannot allocate|memory allocation/i,
        message: 'The system ran out of memory during analysis. Try closing other applications or analyzing a smaller heap dump.'
    },
    {
        pattern: /Analysis cancelled/i,
        message: 'Analysis was cancelled.'
    },
    {
        pattern: /stdin is not available|stdin/i,
        message: 'Cannot communicate with the analysis server. Try reopening the file.'
    }
];

/**
 * Converts a raw error string into a user-friendly message.
 * Returns the original message if no pattern matches.
 */
export function friendlyError(rawError: string): string {
    for (const { pattern, message } of errorPatterns) {
        if (pattern.test(rawError)) {
            return message;
        }
    }
    return rawError;
}
