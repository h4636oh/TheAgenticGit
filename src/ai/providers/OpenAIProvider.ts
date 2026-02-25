import { ModelProvider } from '../ModelProvider';

export class OpenAIProvider implements ModelProvider {
    readonly providerName = 'openai';
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string = 'gpt-4o') {
        this.apiKey = apiKey;
        this.model = model;
    }

    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.2,
                max_tokens: 2048,
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenAI API error (${response.status}): ${err}`);
        }

        const data = await response.json() as any;
        return data.choices?.[0]?.message?.content?.trim() ?? '';
    }

    async listModels(): Promise<string[]> {
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
        });

        if (!response.ok) {
            throw new Error(`OpenAI models list failed: ${response.status}`);
        }

        const data = await response.json() as any;
        return (data.data as any[])
            .map((m: any) => m.id as string)
            .filter((id: string) => id.startsWith('gpt'))
            .sort();
    }
}
