package com.heaplens.agent;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * TCP server that accepts one client at a time and responds to line-delimited JSON commands.
 *
 * Protocol:
 *   Client -> Agent:  {"command":"get_metrics"}\n
 *   Agent -> Client:  {"type":"metrics","data":{...}}\n
 *
 *   Client -> Agent:  {"command":"get_histogram"}\n
 *   Agent -> Client:  {"type":"histogram","data":[...]}\n
 *
 *   Client -> Agent:  {"command":"ping"}\n
 *   Agent -> Client:  {"type":"pong"}\n
 */
public class MetricsServer {
    private final int port;
    private final JmxCollector collector;
    private final int idleTimeoutSeconds;
    private final AtomicBoolean running = new AtomicBoolean(true);
    private final AtomicLong lastActivityTime = new AtomicLong(System.currentTimeMillis());
    private ServerSocket serverSocket;

    public MetricsServer(int port, JmxCollector collector, int idleTimeoutSeconds) {
        this.port = port;
        this.collector = collector;
        this.idleTimeoutSeconds = idleTimeoutSeconds;
    }

    /**
     * Starts the TCP server. Blocks until shutdown.
     */
    public void start() throws Exception {
        serverSocket = new ServerSocket(port);
        serverSocket.setSoTimeout(5000); // Check idle every 5s
        System.err.println("[heaplens-agent] Listening on port " + port);

        // Idle timeout monitor
        Thread idleMonitor = new Thread(() -> {
            while (running.get()) {
                long idle = System.currentTimeMillis() - lastActivityTime.get();
                if (idle > (long) idleTimeoutSeconds * 1000) {
                    System.err.println("[heaplens-agent] Idle timeout (" + idleTimeoutSeconds + "s), shutting down");
                    running.set(false);
                    break;
                }
                try {
                    Thread.sleep(5000);
                } catch (InterruptedException e) {
                    break;
                }
            }
        });
        idleMonitor.setDaemon(true);
        idleMonitor.start();

        while (running.get()) {
            Socket clientSocket;
            try {
                clientSocket = serverSocket.accept();
            } catch (SocketTimeoutException e) {
                continue; // Check running flag
            } catch (Exception e) {
                if (running.get()) {
                    System.err.println("[heaplens-agent] Accept error: " + e.getMessage());
                }
                continue;
            }

            lastActivityTime.set(System.currentTimeMillis());
            System.err.println("[heaplens-agent] Client connected: " + clientSocket.getRemoteSocketAddress());

            handleClient(clientSocket);
        }

        serverSocket.close();
        System.err.println("[heaplens-agent] Server stopped");
    }

    private void handleClient(Socket socket) {
        try (
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            OutputStream out = socket.getOutputStream()
        ) {
            String line;
            while (running.get() && (line = reader.readLine()) != null) {
                lastActivityTime.set(System.currentTimeMillis());
                line = line.trim();
                if (line.isEmpty()) continue;

                String response = handleCommand(line);
                out.write((response + "\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
        } catch (Exception e) {
            System.err.println("[heaplens-agent] Client error: " + e.getMessage());
        } finally {
            try { socket.close(); } catch (Exception e) { /* ignore */ }
            System.err.println("[heaplens-agent] Client disconnected");
        }
    }

    String handleCommand(String line) {
        // Parse command from JSON — minimal parsing without external deps
        String command = extractJsonStringField(line, "command");
        if (command == null) {
            return JsonWriter.error("Missing 'command' field");
        }

        switch (command) {
            case "ping":
                return JsonWriter.pong();

            case "get_metrics":
                try {
                    JvmMetrics metrics = collector.collectMetrics();
                    return JsonWriter.metricsToJson(metrics);
                } catch (Exception e) {
                    return JsonWriter.error("Failed to collect metrics: " + e.getMessage());
                }

            case "get_histogram":
                try {
                    List<ClassHistogramEntry> histogram = collector.collectClassHistogram();
                    return JsonWriter.histogramToJson(histogram);
                } catch (Exception e) {
                    return JsonWriter.error("Failed to collect histogram: " + e.getMessage());
                }

            default:
                return JsonWriter.error("Unknown command: " + command);
        }
    }

    /**
     * Extracts a string value for a given key from a simple JSON object.
     * Minimal parser — handles {"key":"value"} patterns without external deps.
     */
    static String extractJsonStringField(String json, String key) {
        String searchKey = "\"" + key + "\"";
        int keyIdx = json.indexOf(searchKey);
        if (keyIdx < 0) return null;

        int colonIdx = json.indexOf(':', keyIdx + searchKey.length());
        if (colonIdx < 0) return null;

        // Find opening quote of value
        int openQuote = json.indexOf('"', colonIdx + 1);
        if (openQuote < 0) return null;

        // Find closing quote (handle escaped quotes)
        int closeQuote = openQuote + 1;
        while (closeQuote < json.length()) {
            if (json.charAt(closeQuote) == '"' && json.charAt(closeQuote - 1) != '\\') {
                break;
            }
            closeQuote++;
        }
        if (closeQuote >= json.length()) return null;

        return json.substring(openQuote + 1, closeQuote);
    }

    public void stop() {
        running.set(false);
        try {
            if (serverSocket != null && !serverSocket.isClosed()) {
                serverSocket.close();
            }
        } catch (Exception e) {
            // ignore
        }
    }
}
