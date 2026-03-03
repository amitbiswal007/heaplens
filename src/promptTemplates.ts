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

export interface ObjectExplainInfo {
    className: string;
    shallowSize: number;
    retainedSize: number;
    totalHeapSize: number;
    fields: Array<{ name: string; field_type: string; primitive_value?: any; ref_summary?: { class_name: string; retained_size: number } }>;
    gcRootPath?: Array<{ class_name: string; field_name?: string }>;
}

export function buildObjectExplainPrompt(heapContext: string, info: ObjectExplainInfo): string {
    const retainedPct = info.totalHeapSize > 0 ? ((info.retainedSize / info.totalHeapSize) * 100).toFixed(1) : '?';

    let fieldSummary = '';
    if (info.fields && info.fields.length > 0) {
        fieldSummary = '\n\nFields:\n' + info.fields.map(f => {
            if (f.primitive_value !== undefined && f.primitive_value !== null) {
                return `- ${f.name} (${f.field_type}): ${f.primitive_value}`;
            } else if (f.ref_summary) {
                return `- ${f.name} (${f.field_type}): -> ${f.ref_summary.class_name} (retained: ${f.ref_summary.retained_size} bytes)`;
            }
            return `- ${f.name} (${f.field_type}): null`;
        }).join('\n');
    }

    let gcPathSummary = '';
    if (info.gcRootPath && info.gcRootPath.length > 0) {
        gcPathSummary = '\n\nGC Root Path (root -> this object):\n' + info.gcRootPath.map((node, i) => {
            const arrow = i > 0 ? (node.field_name ? ` --(${node.field_name})--> ` : ' --> ') : '';
            return arrow + node.class_name;
        }).join('');
    }

    return `Here is the heap dump analysis data:\n\n${heapContext}\n\n` +
        `I need you to explain the following object in detail:\n\n` +
        `**Object:** ${info.className}\n` +
        `**Shallow Size:** ${info.shallowSize} bytes\n` +
        `**Retained Size:** ${info.retainedSize} bytes (${retainedPct}% of heap)\n` +
        `**Total Heap Size:** ${info.totalHeapSize} bytes` +
        fieldSummary +
        gcPathSummary +
        `\n\nPlease provide:\n` +
        `1. **What this object is** — its role and purpose in a typical Java application\n` +
        `2. **Why it's a memory concern** — explain its retained size as a percentage of the heap, what it's holding onto\n` +
        `3. **Retention chain** — why this object is still alive (use the GC root path if available)\n` +
        `4. **Concrete fix** — specific code patterns to look for, refactoring steps, and configuration changes\n` +
        `5. **Example fix** — provide a before/after Java code snippet showing the problematic pattern and the corrected version. Use the class name, field names, and types from the object data above to make the example realistic. Wrap code in fenced code blocks (\`\`\`java).\n` +
        `6. **Severity** — classify as critical (>20% heap), moderate (5-20%), or low (<5%)\n\n` +
        `Be specific and actionable. A junior developer should be able to follow your advice.`;
}

export interface LeakSuspectExplainInfo {
    className: string;
    retainedSize: number;
    retainedPercentage: number;
    description: string;
}

export function buildLeakSuspectExplainPrompt(heapContext: string, suspect: LeakSuspectExplainInfo): string {
    return `Here is the heap dump analysis data:\n\n${heapContext}\n\n` +
        `I need you to explain the following leak suspect in detail:\n\n` +
        `**Class:** ${suspect.className}\n` +
        `**Retained Size:** ${suspect.retainedSize} bytes (${suspect.retainedPercentage.toFixed(1)}% of heap)\n` +
        `**Description:** ${suspect.description}\n\n` +
        `Please provide:\n` +
        `1. **What this class is** — its role and common usage patterns\n` +
        `2. **Why it's a leak suspect** — what patterns cause this class to accumulate in memory\n` +
        `3. **Common root causes** — specific code anti-patterns that lead to this leak\n` +
        `4. **Concrete fix** — step-by-step refactoring instructions, code patterns to search for, configuration changes\n` +
        `5. **Example fix** — provide a before/after Java code snippet showing the problematic pattern and the corrected version. Use the class name from above to make the example realistic. Wrap code in fenced code blocks (\`\`\`java).\n` +
        `6. **Severity** — classify as critical (>30% heap), moderate (10-30%), or low (<10%)\n\n` +
        `Be specific and actionable. A junior developer should be able to follow your advice.`;
}
