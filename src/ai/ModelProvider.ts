/**
 * Abstract interface for all AI model providers.
 */
export interface ModelProvider {
    /**
     * Send a prompt to the model and return the response text.
     */
    complete(systemPrompt: string, userPrompt: string): Promise<string>;

    /**
     * List all available models for this provider.
     */
    listModels(): Promise<string[]>;

    /**
     * The provider name identifier.
     */
    readonly providerName: string;
}
