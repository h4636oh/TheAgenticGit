import * as vscode from 'vscode';

const KEY_PREFIX = 'theAgenticGit.apiKey.';

export class SecretStorageService {
    constructor(private context: vscode.ExtensionContext) { }

    async storeApiKey(provider: string, key: string): Promise<void> {
        await this.context.secrets.store(`${KEY_PREFIX}${provider}`, key);
    }

    async getApiKey(provider: string): Promise<string | undefined> {
        return this.context.secrets.get(`${KEY_PREFIX}${provider}`);
    }

    async deleteApiKey(provider: string): Promise<void> {
        await this.context.secrets.delete(`${KEY_PREFIX}${provider}`);
    }

    async hasApiKey(provider: string): Promise<boolean> {
        const key = await this.getApiKey(provider);
        return !!key && key.length > 0;
    }
}
