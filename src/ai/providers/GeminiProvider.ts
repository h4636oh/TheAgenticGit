import { ModelProvider } from '../ModelProvider';

export class GeminiProvider implements ModelProvider {
    readonly providerName = 'gemini';
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string = 'gemini-2.0-flash') {
        this.apiKey = apiKey;

        // Auto-migrate deprecated models that throw 404 for generateContent
        if (model === 'gemini-1.5-pro' || model === 'gemini-pro') {
            this.model = 'gemini-1.5-pro-latest';
        } else if (model === 'gemini-1.5-flash' || model === 'gemini-flash') {
            this.model = 'gemini-1.5-flash-latest';
        } else {
            this.model = model || 'gemini-2.0-flash';
        }
    }

    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Gemini API error (${response.status}): ${err}`);
        }

        const data = await response.json() as any;
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    }

    async listModels(): Promise<string[]> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            return ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
        }

        const data = await response.json() as any;
        return (data.models as any[])
            .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
            .map((m: any) => (m.name as string).replace('models/', ''))
            .filter((id: string) => id.startsWith('gemini'))
            .sort();
    }
}
