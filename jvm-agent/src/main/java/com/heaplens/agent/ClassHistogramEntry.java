package com.heaplens.agent;

/**
 * Single entry from a JVM class histogram (GC.class_histogram).
 */
public class ClassHistogramEntry {
    public String className;
    public long instanceCount;
    public long totalBytes;

    public ClassHistogramEntry(String className, long instanceCount, long totalBytes) {
        this.className = className;
        this.instanceCount = instanceCount;
        this.totalBytes = totalBytes;
    }
}
