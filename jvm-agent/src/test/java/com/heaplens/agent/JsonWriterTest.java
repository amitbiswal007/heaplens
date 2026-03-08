package com.heaplens.agent;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;

import static org.junit.Assert.*;

public class JsonWriterTest {

    @Test
    public void testPong() {
        assertEquals("{\"type\":\"pong\"}", JsonWriter.pong());
    }

    @Test
    public void testError() {
        String json = JsonWriter.error("something went wrong");
        assertTrue(json.contains("\"type\":\"error\""));
        assertTrue(json.contains("\"message\":\"something went wrong\""));
    }

    @Test
    public void testEscapeString() {
        assertEquals("\"hello\"", JsonWriter.escapeString("hello"));
        assertEquals("\"he\\\"llo\"", JsonWriter.escapeString("he\"llo"));
        assertEquals("\"line1\\nline2\"", JsonWriter.escapeString("line1\nline2"));
        assertEquals("\"tab\\there\"", JsonWriter.escapeString("tab\there"));
        assertEquals("null", JsonWriter.escapeString(null));
    }

    @Test
    public void testMetricsToJson() {
        JvmMetrics m = new JvmMetrics();
        m.timestamp = 1700000000000L;
        m.heapUsed = 100_000_000;
        m.heapMax = 500_000_000;
        m.heapCommitted = 200_000_000;
        m.nonHeapUsed = 30_000_000;
        m.nonHeapCommitted = 50_000_000;
        m.threadCount = 42;
        m.daemonThreadCount = 10;
        m.uptime = 300000;
        m.gcCollectors = Arrays.asList(
                new JvmMetrics.GcCollectorInfo("G1 Young Generation", 100, 500)
        );
        m.memoryPools = Arrays.asList(
                new JvmMetrics.MemoryPoolInfo("G1 Eden Space", "HEAP", 50000, 100000, 80000)
        );

        String json = JsonWriter.metricsToJson(m);
        assertTrue(json.startsWith("{\"type\":\"metrics\""));
        assertTrue(json.contains("\"heapUsed\":100000000"));
        assertTrue(json.contains("\"heapMax\":500000000"));
        assertTrue(json.contains("\"threadCount\":42"));
        assertTrue(json.contains("\"G1 Young Generation\""));
        assertTrue(json.contains("\"G1 Eden Space\""));
        assertTrue(json.contains("\"collectionCount\":100"));
    }

    @Test
    public void testMetricsNullCollectors() {
        JvmMetrics m = new JvmMetrics();
        m.gcCollectors = null;
        m.memoryPools = null;
        String json = JsonWriter.metricsToJson(m);
        assertTrue(json.contains("\"gcCollectors\":[]"));
        assertTrue(json.contains("\"memoryPools\":[]"));
    }

    @Test
    public void testHistogramToJson() {
        ClassHistogramEntry e1 = new ClassHistogramEntry("java.lang.String", 1000, 50000);
        ClassHistogramEntry e2 = new ClassHistogramEntry("byte[]", 500, 200000);
        String json = JsonWriter.histogramToJson(Arrays.asList(e1, e2));

        assertTrue(json.startsWith("{\"type\":\"histogram\""));
        assertTrue(json.contains("\"className\":\"java.lang.String\""));
        assertTrue(json.contains("\"instanceCount\":1000"));
        assertTrue(json.contains("\"totalBytes\":50000"));
        assertTrue(json.contains("\"className\":\"byte[]\""));
    }

    @Test
    public void testHistogramEmpty() {
        String json = JsonWriter.histogramToJson(Collections.emptyList());
        assertEquals("{\"type\":\"histogram\",\"data\":[]}", json);
    }

    @Test
    public void testHistogramNull() {
        String json = JsonWriter.histogramToJson(null);
        assertEquals("{\"type\":\"histogram\",\"data\":[]}", json);
    }
}
