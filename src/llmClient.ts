/**
 * HTTP streaming client for Anthropic and OpenAI APIs.
 *
 * Uses Node.js built-in https/http modules — no npm dependencies.
 * API key stays in the extension process (never exposed to the webview).
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export interface LlmConfig {
    provider: 'anthropic' | 'openai';
    apiKey: string;
    baseUrl?: string;
    model?: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

/**
 * Streams an LLM response, calling callbacks for each chunk.
 */
export function streamLlmResponse(
    config: LlmConfig,
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (error: string) => void
): void {
    if (!config.apiKey) {
        onError('No API key configured. Set heaplens.llm.apiKey in VS Code settings.');
        return;
    }

    if (config.provider === 'anthropic') {
        streamAnthropic(config, messages, onChunk, onDone, onError);
    } else {
        streamOpenAI(config, messages, onChunk, onDone, onError);
    }
}

function streamAnthropic(
    config: LlmConfig,
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (error: string) => void
): void {
    const baseUrl = config.baseUrl || 'https://api.anthropic.com';
    const model = config.model || 'claude-sonnet-4-20250514';

    // Separate system message from conversation messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const body = JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        system: systemMessages.map(m => m.content).join('\n\n') || undefined,
        messages: conversationMessages.map(m => ({
            role: m.role,
            content: m.content
        }))
    });

    const url = new URL(`${baseUrl}/v1/messages`);
    const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body)
        }
    };

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
            let errorBody = '';
            res.on('data', (chunk) => { errorBody += chunk.toString(); });
            res.on('end', () => {
                onError(`Anthropic API error (${res.statusCode}): ${errorBody}`);
            });
            return;
        }

        let buffer = '';
        res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') { continue; }
                    try {
                        const event = JSON.parse(data);
                        if (event.type === 'content_block_delta' && event.delta?.text) {
                            onChunk(event.delta.text);
                        } else if (event.type === 'message_stop') {
                            // Stream complete
                        }
                    } catch {
                        // Skip malformed SSE lines
                    }
                }
            }
        });

        res.on('end', () => { onDone(); });
    });

    req.on('error', (err) => {
        onError(`Request failed: ${err.message}`);
    });

    req.write(body);
    req.end();
}

function streamOpenAI(
    config: LlmConfig,
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (error: string) => void
): void {
    const baseUrl = config.baseUrl || 'https://api.openai.com';
    const model = config.model || 'gpt-4o';

    const body = JSON.stringify({
        model,
        stream: true,
        messages: messages.map(m => ({
            role: m.role,
            content: m.content
        }))
    });

    const url = new URL(`${baseUrl}/v1/chat/completions`);
    const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Length': Buffer.byteLength(body)
        }
    };

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
            let errorBody = '';
            res.on('data', (chunk) => { errorBody += chunk.toString(); });
            res.on('end', () => {
                onError(`OpenAI API error (${res.statusCode}): ${errorBody}`);
            });
            return;
        }

        let buffer = '';
        res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') { continue; }
                    try {
                        const event = JSON.parse(data);
                        const content = event.choices?.[0]?.delta?.content;
                        if (content) {
                            onChunk(content);
                        }
                    } catch {
                        // Skip malformed SSE lines
                    }
                }
            }
        });

        res.on('end', () => { onDone(); });
    });

    req.on('error', (err) => {
        onError(`Request failed: ${err.message}`);
    });

    req.write(body);
    req.end();
}
