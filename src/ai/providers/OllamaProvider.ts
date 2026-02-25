import { ModelProvider } from '../ModelProvider';

export class OllamaProvider implements ModelProvider {
    readonly providerName = 'ollama';
    private baseUrl: string;
    private model: string;

    constructor(baseUrl: string = 'http://localhost:11434', model: string = 'llama3.2') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.model = model;
    }

    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                stream: false,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                options: { temperature: 0.2 },
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Ollama error (${response.status}): ${err}`);
        }

        const data = await response.json() as any;
        return data.message?.content?.trim() ?? '';
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) { return []; }
            const data = await response.json() as any;
            return (data.models as any[]).map((m: any) => m.name as string).sort();
        } catch {
            return [];
        }
    }
}
