import * as vscode from 'vscode';
import { ModelProvider } from './ModelProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { SecretStorageService } from '../services/SecretStorageService';

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export class ProviderFactory {
    static async create(context: vscode.ExtensionContext): Promise<ModelProvider> {
        const config = vscode.workspace.getConfiguration('theAgenticGit');
        const providerName = config.get<ProviderName>('provider', 'ollama');
        const model = config.get<string>('model', '');
        const ollamaBaseUrl = config.get<string>('ollamaBaseUrl', 'http://localhost:11434');

        const secretService = new SecretStorageService(context);

        switch (providerName) {
            case 'openai': {
                const key = await secretService.getApiKey('openai');
                if (!key) { throw new Error('No OpenAI API key stored. Go to TheAgenticGit Settings to add one.'); }
                return new OpenAIProvider(key, model || 'gpt-4o');
            }
            case 'anthropic': {
                const key = await secretService.getApiKey('anthropic');
                if (!key) { throw new Error('No Anthropic API key stored. Go to TheAgenticGit Settings to add one.'); }
                return new AnthropicProvider(key, model || 'claude-3-5-sonnet-20241022');
            }
            case 'gemini': {
                const key = await secretService.getApiKey('gemini');
                if (!key) { throw new Error('No Gemini API key stored. Go to TheAgenticGit Settings to add one.'); }
                return new GeminiProvider(key, model || 'gemini-2.0-flash');
            }
            case 'ollama':
            default: {
                return new OllamaProvider(ollamaBaseUrl, model || 'llama3.2');
            }
        }
    }
}
