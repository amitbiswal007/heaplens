package com.heaplens.agent;

import org.junit.Test;
import static org.junit.Assert.*;

public class AgentConfigTest {

    @Test
    public void testParseJmxHostAndPort() {
        AgentConfig config = AgentConfig.parse(new String[]{
                "--jmx-host", "192.168.1.10", "--jmx-port", "9010"
        });
        assertEquals("192.168.1.10", config.getJmxHost());
        assertEquals(9010, config.getJmxPort());
        assertEquals(9095, config.getListenPort()); // default
        assertFalse(config.isLocalAttach());
        assertNull(config.validate());
    }

    @Test
    public void testParsePid() {
        AgentConfig config = AgentConfig.parse(new String[]{
                "--pid", "12345", "--jmx-port", "9010"
        });
        assertEquals(12345, config.getPid());
        assertTrue(config.isLocalAttach());
        assertNull(config.validate());
    }

    @Test
    public void testParseListenPort() {
        AgentConfig config = AgentConfig.parse(new String[]{
                "--jmx-port", "9010", "--listen-port", "8888"
        });
        assertEquals(8888, config.getListenPort());
        assertNull(config.validate());
    }

    @Test
    public void testParseIdleTimeout() {
        AgentConfig config = AgentConfig.parse(new String[]{
                "--jmx-port", "9010", "--idle-timeout", "120"
        });
        assertEquals(120, config.getIdleTimeoutSeconds());
    }

    @Test
    public void testValidateNoPidOrJmxPort() {
        AgentConfig config = AgentConfig.parse(new String[]{});
        assertNotNull(config.validate());
        assertTrue(config.validate().contains("--pid"));
    }

    @Test
    public void testDefaultHost() {
        AgentConfig config = AgentConfig.parse(new String[]{"--jmx-port", "9010"});
        assertEquals("localhost", config.getJmxHost());
    }

    @Test
    public void testUnknownArgIgnored() {
        AgentConfig config = AgentConfig.parse(new String[]{
                "--unknown", "--jmx-port", "9010"
        });
        assertEquals(9010, config.getJmxPort());
    }
}
