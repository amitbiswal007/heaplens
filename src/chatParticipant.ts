/**
 * VS Code Chat Participant for HeapLens (@heaplens).
 *
 * Registers a chat participant in Copilot Chat with slash commands:
 *   /analyze — General heap analysis
 *   /leaks  — Focused leak suspect analysis
 *   /explain — Explain a specific class or concept
 */

import * as vscode from 'vscode';
import { AnalysisData, formatAnalysisContext } from './analysisContext';
import {
    HEAP_ANALYSIS_SYSTEM_PROMPT,
    buildAnalyzePrompt,
    buildLeaksPrompt,
    buildExplainPrompt
} from './promptTemplates';

export function registerChatParticipant(
    context: vscode.ExtensionContext,
    getAnalysisData: () => AnalysisData | null
): void {
    const participant = vscode.chat.createChatParticipant('heaplens.chat', async (
        request: vscode.ChatRequest,
        chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ) => {
        // Check if we have analysis data
        const data = getAnalysisData();
        if (!data) {
            stream.markdown('No heap analysis data available. Please open an `.hprof` file first and wait for the analysis to complete.');
            return;
        }

        // Format analysis context
        const analysisContext = formatAnalysisContext(data);

        // Build user prompt based on slash command
        let userPrompt: string;
        const userQuestion = request.prompt.trim();

        switch (request.command) {
            case 'leaks':
                userPrompt = buildLeaksPrompt(analysisContext, userQuestion || undefined);
                break;
            case 'explain':
                if (!userQuestion) {
                    stream.markdown('Please provide a class name or concept to explain. For example: `@heaplens /explain byte[]`');
                    return;
                }
                userPrompt = buildExplainPrompt(analysisContext, userQuestion);
                break;
            case 'analyze':
            default:
                userPrompt = buildAnalyzePrompt(analysisContext, userQuestion || undefined);
                break;
        }

        // Select a chat model
        let models: vscode.LanguageModelChat[];
        try {
            models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
        } catch {
            models = [];
        }

        // Fallback: try any available model
        if (models.length === 0) {
            try {
                models = await vscode.lm.selectChatModels();
            } catch {
                models = [];
            }
        }

        if (models.length === 0) {
            stream.markdown('No language model available. Make sure GitHub Copilot is installed and signed in.');
            return;
        }

        const model = models[0];

        // Build messages
        const messages = [
            vscode.LanguageModelChatMessage.User(HEAP_ANALYSIS_SYSTEM_PROMPT),
            vscode.LanguageModelChatMessage.User(userPrompt)
        ];

        // Include prior conversation turns for context
        for (const turn of chatContext.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
            } else if (turn instanceof vscode.ChatResponseTurn) {
                const parts: string[] = [];
                for (const part of turn.response) {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        parts.push(part.value.value);
                    }
                }
                if (parts.length > 0) {
                    messages.push(vscode.LanguageModelChatMessage.Assistant(parts.join('')));
                }
            }
        }

        // Stream the response
        try {
            const response = await model.sendRequest(messages, {}, token);
            for await (const fragment of response.text) {
                if (token.isCancellationRequested) { break; }
                stream.markdown(fragment);
            }
        } catch (err: unknown) {
            if (err instanceof vscode.LanguageModelError) {
                stream.markdown(`Language model error: ${err.message}`);
            } else {
                throw err;
            }
        }
    });

    participant.iconPath = new vscode.ThemeIcon('search');

    context.subscriptions.push(participant);
}
