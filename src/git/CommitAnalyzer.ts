import { ModelProvider } from '../ai/ModelProvider';
import { GitService } from './GitService';

export interface CommitSuggestion {
    type: string;
    scope: string;
    subject: string;
    body: string;
    fullMessage: string;
    breaking: boolean;
}

const SYSTEM_PROMPT = `You are an expert at writing conventional commit messages.
Given a git diff, produce a commit message following the Conventional Commits spec.
Respond ONLY with a JSON object — no markdown, no explanation, no code fences.

Schema:
{
  "type": "feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert",
  "scope": "optional scope in parentheses, empty string if none",
  "subject": "short imperative summary, max 72 chars, no period",
  "body": "optional longer explanation, wrap at 72 chars, empty string if not needed",
  "breaking": false
}

Rules:
- Use type "feat" for new functionality, "fix" for bug fixes, "refactor" for code restructuring
- Scope should be the main module/component changed (e.g., "auth", "ui", "api")
- Subject must be lowercase imperative mood ("add feature" not "Added feature")
- If it's a breaking change, set breaking: true and explain in body
`;

export class CommitAnalyzer {
    constructor(
        private provider: ModelProvider,
        private gitService: GitService,
    ) { }

    async suggest(): Promise<CommitSuggestion> {
        const diff = await this.gitService.getStagedDiff();

        if (!diff || diff.trim().length === 0) {
            throw new Error('No staged changes found. Stage your changes with `git add` first.');
        }

        // Truncate very large diffs
        const truncated = diff.length > 8000 ? diff.substring(0, 8000) + '\n... (diff truncated)' : diff;

        const raw = await this.provider.complete(SYSTEM_PROMPT, `Git diff:\n${truncated}`);
        const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

        let result: any;
        try {
            result = JSON.parse(cleaned);
        } catch {
            throw new Error(`AI returned invalid JSON. Raw: ${raw}`);
        }

        const { type, scope, subject, body, breaking } = result;
        const header = scope
            ? `${type}(${scope})${breaking ? '!' : ''}: ${subject}`
            : `${type}${breaking ? '!' : ''}: ${subject}`;

        const fullMessage = [
            header,
            body ? '' : null,
            body || null,
            breaking ? '' : null,
            breaking ? 'BREAKING CHANGE: see body for details' : null,
        ].filter(l => l !== null).join('\n');

        return { type, scope, subject, body, fullMessage, breaking };
    }
}
