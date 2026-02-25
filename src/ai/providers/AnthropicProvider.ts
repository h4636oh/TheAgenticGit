import { ModelProvider } from '../ModelProvider';

export class AnthropicProvider implements ModelProvider {
    readonly providerName = 'anthropic';
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20241022') {
        this.apiKey = apiKey;
        this.model = model;
    }

    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: this.model,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
                max_tokens: 2048,
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Anthropic API error (${response.status}): ${err}`);
        }

        const data = await response.json() as any;
        return data.content?.[0]?.text?.trim() ?? '';
    }

    async listModels(): Promise<string[]> {
        return [
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229',
            'claude-3-haiku-20240307',
        ];
    }
}
