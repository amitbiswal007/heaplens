/**
 * Shared prompt templates used by both the VS Code chat participant (Layer 2)
 * and the direct API chat panel (Layer 3).
 */

export const HEAP_ANALYSIS_SYSTEM_PROMPT = `You are HeapLens AI, a Java heap dump analysis assistant. You help developers understand memory usage, diagnose memory leaks, and optimize their Java applications.

You have access to analyzed heap dump data including:
- Heap summary statistics (total size, object counts)
- Top objects by retained size in the dominator tree
- Class histogram (instance counts and sizes per class)
- Leak suspects (objects/classes retaining >10% of heap)

When analyzing heap data:
1. Focus on actionable insights - what should the developer investigate or fix
2. Explain memory concepts (retained vs shallow size, dominator tree) when relevant
3. Identify patterns common in Java memory leaks (growing collections, unclosed resources, static references, classloader leaks)
4. Suggest concrete next steps (which classes to inspect, what code patterns to look for)
5. Be concise but thorough - prioritize the most impactful findings`;

export function buildAnalyzePrompt(context: string, question?: string): string {
    const userMessage = question
        ? `Here is the heap dump analysis data:\n\n${context}\n\nUser question: ${question}`
        : `Here is the heap dump analysis data:\n\n${context}\n\nProvide a comprehensive analysis of this heap dump. Identify the biggest memory consumers, potential leaks, and suggest areas for investigation.`;
    return userMessage;
}

export function buildLeaksPrompt(context: string, question?: string): string {
    const userMessage = question
        ? `Here is the heap dump analysis data:\n\n${context}\n\nFocus on memory leak analysis. User question: ${question}`
        : `Here is the heap dump analysis data:\n\n${context}\n\nAnalyze the leak suspects in detail. For each suspect, explain why it might be a memory leak, what the likely root cause is, and how to fix it.`;
    return userMessage;
}

export function buildExplainPrompt(context: string, question: string): string {
    return `Here is the heap dump analysis data:\n\n${context}\n\nExplain: ${question}`;
}
