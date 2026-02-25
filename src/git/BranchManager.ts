import { ModelProvider } from '../ai/ModelProvider';

export interface BranchSuggestion {
    name: string;
    rationale: string;
}

const SYSTEM_PROMPT = `You are an expert at naming Git branches using semantic naming conventions.
Given a task or feature description, suggest 3 branch names.
Respond ONLY with a JSON array — no markdown, no explanation.

Schema: [{"name": "feat/short-hyphen-name", "rationale": "why this name fits"}]

Rules:
- Use prefixes: feat/, fix/, chore/, docs/, refactor/, test/, hotfix/
- Use lowercase kebab-case only
- Max 50 characters total
- Be specific and descriptive, not generic (avoid "fix/bug" or "feat/new-feature")
- Names should communicate the WHAT, not the HOW
`;

export class BranchManager {
    constructor(private provider: ModelProvider) { }

    async suggest(description: string): Promise<BranchSuggestion[]> {
        const raw = await this.provider.complete(
            SYSTEM_PROMPT,
            `Task description: "${description}"\n\nProvide 3 branch name suggestions.`
        );

        const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

        let result: any[];
        try {
            result = JSON.parse(cleaned);
        } catch {
            throw new Error(`AI returned invalid JSON. Raw: ${raw}`);
        }

        return result as BranchSuggestion[];
    }
}
