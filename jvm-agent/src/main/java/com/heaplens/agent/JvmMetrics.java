package com.heaplens.agent;

import java.util.List;

/**
 * POJO holding a snapshot of JVM metrics collected via JMX.
 */
public class JvmMetrics {
    public long timestamp;
    public long heapUsed;
    public long heapMax;
    public long heapCommitted;
    public long nonHeapUsed;
    public long nonHeapCommitted;
    public int threadCount;
    public int daemonThreadCount;
    public long uptime;
    public List<GcCollectorInfo> gcCollectors;
    public List<MemoryPoolInfo> memoryPools;

    public static class GcCollectorInfo {
        public String name;
        public long collectionCount;
        public long collectionTimeMs;

        public GcCollectorInfo(String name, long collectionCount, long collectionTimeMs) {
            this.name = name;
            this.collectionCount = collectionCount;
            this.collectionTimeMs = collectionTimeMs;
        }
    }

    public static class MemoryPoolInfo {
        public String name;
        public String type;
        public long used;
        public long max;
        public long committed;

        public MemoryPoolInfo(String name, String type, long used, long max, long committed) {
            this.name = name;
            this.type = type;
            this.used = used;
            this.max = max;
            this.committed = committed;
        }
    }
}
