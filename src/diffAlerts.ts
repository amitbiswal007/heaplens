import * as vscode from 'vscode';
import { trackEvent } from './telemetry';

// --- Types matching Rust compare result structure ---

interface ClassDelta {
    class_name: string;
    instance_count_delta: number;
    shallow_size_delta: number;
    retained_size_delta: number;
    current_instance_count?: number;
    current_retained_size?: number;
}

interface LeakSuspectChange {
    class_name: string;
    status: 'new' | 'resolved' | 'persisted';
    current_retained_percentage?: number;
}

interface CompareResult {
    heap_size_delta?: number;
    current_heap_size?: number;
    baseline_heap_size?: number;
    class_deltas?: ClassDelta[];
    leak_suspect_changes?: LeakSuspectChange[];
}

interface AlertConfig {
    enabled: boolean;
    heapGrowthThreshold: number;
}

interface Alert {
    id: string;
    severity: 'warning' | 'info';
    message: string;
}

interface AlertRule {
    id: string;
    evaluate(result: CompareResult, config: AlertConfig): Alert | null;
}

// --- Alert rules ---

const ALERT_RULES: AlertRule[] = [
    {
        id: 'heap-growth',
        evaluate(result, config) {
            const baseline = result.baseline_heap_size;
            const delta = result.heap_size_delta;
            if (!baseline || baseline === 0 || delta === undefined) { return null; }
            const pct = (delta / baseline) * 100;
            if (pct <= config.heapGrowthThreshold) { return null; }
            const mb = (delta / (1024 * 1024)).toFixed(1);
            return {
                id: 'heap-growth',
                severity: 'warning',
                message: `Heap grew ${pct.toFixed(0)}% (+${mb} MB) compared to baseline`
            };
        }
    },
    {
        id: 'new-leak-suspects',
        evaluate(result) {
            const newLeaks = (result.leak_suspect_changes || [])
                .filter(l => l.status === 'new');
            if (newLeaks.length === 0) { return null; }
            const names = newLeaks.slice(0, 3).map(l => l.class_name).join(', ');
            const suffix = newLeaks.length > 3 ? ` and ${newLeaks.length - 3} more` : '';
            return {
                id: 'new-leak-suspects',
                severity: 'warning',
                message: `${newLeaks.length} new leak suspect(s): ${names}${suffix}`
            };
        }
    },
    {
        id: 'class-explosion',
        evaluate(result) {
            const explosive = (result.class_deltas || []).filter(d =>
                d.current_instance_count !== undefined &&
                d.instance_count_delta > 0 &&
                d.current_instance_count > 0 &&
                d.instance_count_delta >= d.current_instance_count - d.instance_count_delta &&
                (d.current_retained_size || 0) > 1024 * 1024
            );
            if (explosive.length === 0) { return null; }
            const top = explosive[0];
            return {
                id: 'class-explosion',
                severity: 'warning',
                message: `${top.class_name} instances more than doubled (+${top.instance_count_delta}) with ${((top.current_retained_size || 0) / (1024 * 1024)).toFixed(1)} MB retained`
            };
        }
    },
    {
        id: 'resolved-leaks',
        evaluate(result) {
            const resolved = (result.leak_suspect_changes || [])
                .filter(l => l.status === 'resolved');
            if (resolved.length === 0) { return null; }
            const names = resolved.slice(0, 3).map(l => l.class_name).join(', ');
            return {
                id: 'resolved-leaks',
                severity: 'info',
                message: `${resolved.length} leak suspect(s) resolved: ${names}`
            };
        }
    }
];

// --- Main entry point ---

export function evaluateAlerts(
    compareResult: CompareResult,
    ctx: { webviewPanel: vscode.WebviewPanel }
): void {
    const settings = vscode.workspace.getConfiguration('heaplens.alerts');
    const config: AlertConfig = {
        enabled: settings.get<boolean>('enabled', true),
        heapGrowthThreshold: settings.get<number>('heapGrowthThreshold', 25)
    };

    if (!config.enabled) { return; }

    for (const rule of ALERT_RULES) {
        const alert = rule.evaluate(compareResult, config);
        if (!alert) { continue; }

        trackEvent('alert/fired', { ruleId: alert.id, severity: alert.severity });

        const showFn = alert.severity === 'warning'
            ? vscode.window.showWarningMessage
            : vscode.window.showInformationMessage;

        showFn(alert.message, 'View Comparison').then(choice => {
            if (choice === 'View Comparison') {
                trackEvent('alert/viewComparison', { ruleId: alert.id });
                ctx.webviewPanel.reveal();
            }
        });
    }
}
