/**
 * Formats raw heap analysis data into LLM-friendly structured text context.
 *
 * Used by both the VS Code chat participant (Layer 2) and the direct API chat (Layer 3)
 * to provide heap analysis context to LLMs.
 */

export interface AnalysisData {
    summary: {
        total_heap_size: number;
        total_instances: number;
        total_classes: number;
        total_arrays: number;
        total_gc_roots: number;
    } | null;
    topObjects: Array<{
        object_id: number;
        node_type: string;
        class_name: string;
        shallow_size: number;
        retained_size: number;
    }>;
    leakSuspects: Array<{
        class_name: string;
        object_id: number;
        retained_size: number;
        retained_percentage: number;
        description: string;
        dependency?: { groupId: string; artifactId: string; version: string };
    }>;
    classHistogram: Array<{
        class_name: string;
        instance_count: number;
        shallow_size: number;
        retained_size: number;
    }>;
}

function fmtBytes(bytes: number): string {
    if (bytes === 0) { return '0 B'; }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const idx = Math.min(i, sizes.length - 1);
    const val = bytes / Math.pow(k, idx);
    return idx > 1 ? `${val.toFixed(2)} ${sizes[idx]}` : `${Math.round(val)} ${sizes[idx]}`;
}

/**
 * Formats analysis data into structured markdown text suitable for LLM consumption.
 * Limits output to keep within reasonable token counts (~2-3K tokens).
 */
export function formatAnalysisContext(data: AnalysisData): string {
    const parts: string[] = [];

    // Summary
    if (data.summary) {
        const s = data.summary;
        parts.push(
            '## Heap Summary\n',
            `- Total Heap Size: ${fmtBytes(s.total_heap_size)}`,
            `- Objects: ${s.total_instances.toLocaleString()}`,
            `- Classes: ${s.total_classes.toLocaleString()}`,
            `- Arrays: ${s.total_arrays.toLocaleString()}`,
            `- GC Roots: ${s.total_gc_roots.toLocaleString()}`,
            ''
        );
    }

    // Top objects (limit 15)
    const filtered = data.topObjects
        .filter(o => o.retained_size > 0 && o.node_type !== 'Class' && o.node_type !== 'SuperRoot')
        .slice(0, 15);

    if (filtered.length > 0) {
        parts.push('## Top Objects by Retained Size\n');
        parts.push('| # | Class | Type | Shallow | Retained |');
        parts.push('|---|-------|------|---------|----------|');
        filtered.forEach((o, i) => {
            const name = o.class_name || o.node_type;
            parts.push(`| ${i + 1} | ${name} | ${o.node_type} | ${fmtBytes(o.shallow_size)} | ${fmtBytes(o.retained_size)} |`);
        });
        parts.push('');
    }

    // Leak suspects (all)
    if (data.leakSuspects.length > 0) {
        parts.push('## Leak Suspects\n');
        for (const s of data.leakSuspects) {
            const severity = s.retained_percentage > 30 ? 'HIGH' : 'MEDIUM';
            const depSuffix = s.dependency ? ` (from ${s.dependency.groupId}:${s.dependency.artifactId}:${s.dependency.version})` : '';
            parts.push(`- **[${severity}] ${s.class_name}**${depSuffix} - retains ${s.retained_percentage.toFixed(1)}% of heap (${fmtBytes(s.retained_size)}) - ${s.description}`);
        }
        parts.push('');
    }

    // Class histogram (limit 20)
    const histLimit = Math.min(data.classHistogram.length, 20);
    if (histLimit > 0) {
        parts.push(`## Class Histogram (top ${histLimit} of ${data.classHistogram.length})\n`);
        parts.push('| Class | Instances | Shallow | Retained |');
        parts.push('|-------|-----------|---------|----------|');
        for (let i = 0; i < histLimit; i++) {
            const e = data.classHistogram[i];
            parts.push(`| ${e.class_name} | ${e.instance_count.toLocaleString()} | ${fmtBytes(e.shallow_size)} | ${fmtBytes(e.retained_size)} |`);
        }
        parts.push('');
    }

    return parts.join('\n');
}
