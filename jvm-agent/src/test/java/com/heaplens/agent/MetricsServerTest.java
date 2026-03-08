package com.heaplens.agent;

import org.junit.Test;

import static org.junit.Assert.*;

public class MetricsServerTest {

    @Test
    public void testExtractJsonStringField() {
        assertEquals("get_metrics",
                MetricsServer.extractJsonStringField("{\"command\":\"get_metrics\"}", "command"));
        assertEquals("ping",
                MetricsServer.extractJsonStringField("{\"command\":\"ping\"}", "command"));
        assertNull(MetricsServer.extractJsonStringField("{\"foo\":\"bar\"}", "command"));
        assertNull(MetricsServer.extractJsonStringField("invalid json", "command"));
    }

    @Test
    public void testExtractFieldWithSpaces() {
        assertEquals("hello world",
                MetricsServer.extractJsonStringField("{\"key\" : \"hello world\"}", "key"));
    }

    @Test
    public void testExtractFieldWithEscapedQuotes() {
        // The minimal parser returns raw content between quotes (no unescaping)
        assertEquals("he\\\\\\\"llo",
                MetricsServer.extractJsonStringField("{\"key\":\"he\\\\\\\"llo\"}", "key"));
    }

    @Test
    public void testHandleCommandPing() {
        // Use a mock collector that doesn't actually connect to JMX
        MetricsServer server = new MetricsServer(0, null, 60);
        String response = server.handleCommand("{\"command\":\"ping\"}");
        assertEquals("{\"type\":\"pong\"}", response);
    }

    @Test
    public void testHandleCommandUnknown() {
        MetricsServer server = new MetricsServer(0, null, 60);
        String response = server.handleCommand("{\"command\":\"unknown_cmd\"}");
        assertTrue(response.contains("\"type\":\"error\""));
        assertTrue(response.contains("Unknown command"));
    }

    @Test
    public void testHandleCommandMissingField() {
        MetricsServer server = new MetricsServer(0, null, 60);
        String response = server.handleCommand("{\"foo\":\"bar\"}");
        assertTrue(response.contains("\"type\":\"error\""));
        assertTrue(response.contains("Missing"));
    }
}
