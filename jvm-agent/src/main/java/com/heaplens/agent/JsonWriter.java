package com.heaplens.agent;

import java.util.List;

/**
 * Minimal JSON serializer with zero external dependencies.
 * Produces compact JSON strings for the agent TCP protocol.
 */
public class JsonWriter {

    public static String metricsToJson(JvmMetrics m) {
        StringBuilder sb = new StringBuilder(512);
        sb.append("{\"type\":\"metrics\",\"data\":{");
        sb.append("\"timestamp\":").append(m.timestamp);
        sb.append(",\"heapUsed\":").append(m.heapUsed);
        sb.append(",\"heapMax\":").append(m.heapMax);
        sb.append(",\"heapCommitted\":").append(m.heapCommitted);
        sb.append(",\"nonHeapUsed\":").append(m.nonHeapUsed);
        sb.append(",\"nonHeapCommitted\":").append(m.nonHeapCommitted);
        sb.append(",\"threadCount\":").append(m.threadCount);
        sb.append(",\"daemonThreadCount\":").append(m.daemonThreadCount);
        sb.append(",\"uptime\":").append(m.uptime);

        // GC collectors
        sb.append(",\"gcCollectors\":[");
        if (m.gcCollectors != null) {
            for (int i = 0; i < m.gcCollectors.size(); i++) {
                if (i > 0) sb.append(',');
                JvmMetrics.GcCollectorInfo gc = m.gcCollectors.get(i);
                sb.append("{\"name\":").append(escapeString(gc.name));
                sb.append(",\"collectionCount\":").append(gc.collectionCount);
                sb.append(",\"collectionTimeMs\":").append(gc.collectionTimeMs);
                sb.append('}');
            }
        }
        sb.append(']');

        // Memory pools
        sb.append(",\"memoryPools\":[");
        if (m.memoryPools != null) {
            for (int i = 0; i < m.memoryPools.size(); i++) {
                if (i > 0) sb.append(',');
                JvmMetrics.MemoryPoolInfo pool = m.memoryPools.get(i);
                sb.append("{\"name\":").append(escapeString(pool.name));
                sb.append(",\"type\":").append(escapeString(pool.type));
                sb.append(",\"used\":").append(pool.used);
                sb.append(",\"max\":").append(pool.max);
                sb.append(",\"committed\":").append(pool.committed);
                sb.append('}');
            }
        }
        sb.append(']');

        sb.append("}}");
        return sb.toString();
    }

    public static String histogramToJson(List<ClassHistogramEntry> entries) {
        StringBuilder sb = new StringBuilder(4096);
        sb.append("{\"type\":\"histogram\",\"data\":[");
        if (entries != null) {
            for (int i = 0; i < entries.size(); i++) {
                if (i > 0) sb.append(',');
                ClassHistogramEntry e = entries.get(i);
                sb.append("{\"className\":").append(escapeString(e.className));
                sb.append(",\"instanceCount\":").append(e.instanceCount);
                sb.append(",\"totalBytes\":").append(e.totalBytes);
                sb.append('}');
            }
        }
        sb.append("]}");
        return sb.toString();
    }

    public static String pong() {
        return "{\"type\":\"pong\"}";
    }

    public static String error(String message) {
        return "{\"type\":\"error\",\"message\":" + escapeString(message) + "}";
    }

    static String escapeString(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder(s.length() + 2);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
        return sb.toString();
    }
}
