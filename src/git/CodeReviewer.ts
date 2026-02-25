import { ModelProvider } from '../ai/ModelProvider';
import { GitService } from './GitService';

export interface CodeReview {
    summary: string;
    filesReviewed: string[];
    findings: Finding[];
    verdict: 'looks good' | 'minor issues' | 'needs attention' | 'critical issues';
}

export interface Finding {
    file: string;
    line?: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
}

const SYSTEM_PROMPT = `You are a senior software engineer performing a code review.
Analyze the provided git diff and give a thorough, constructive review.
Respond ONLY with a JSON object — no markdown, no code fences.

Schema:
{
  "summary": "2-3 sentence overview of what this change does",
  "filesReviewed": ["list of file paths reviewed"],
  "findings": [
    {
      "file": "path/to/file",
      "line": "optional line reference like L42 or L10-20",
      "severity": "info|warning|error",
      "message": "specific, actionable feedback"
    }
  ],
  "verdict": "looks good|minor issues|needs attention|critical issues"
}

Review checklist:
- Logic errors or off-by-one bugs
- Security vulnerabilities (unescaped input, SQL injection, etc.)
- Performance issues (N+1 queries, blocking calls)
- Missing error handling
- Code that could be simplified
- Missing or outdated tests
- Breaking changes in public APIs
- Info-level: style, naming suggestions, optional improvements
`;

export class CodeReviewer {
    constructor(
        private provider: ModelProvider,
        private gitService: GitService,
    ) { }

    async review(target: 'staged' | 'full' = 'staged'): Promise<CodeReview> {
        const diff = target === 'staged'
            ? await this.gitService.getStagedDiff()
            : await this.gitService.getFullDiff();

        if (!diff || diff.trim().length === 0) {
            throw new Error(`No ${target === 'staged' ? 'staged ' : ''}changes to review.`);
        }

        const truncated = diff.length > 10000 ? diff.substring(0, 10000) + '\n...(diff truncated)' : diff;

        const raw = await this.provider.complete(SYSTEM_PROMPT, `Git diff:\n${truncated}`);
        const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

        let result: CodeReview;
        try {
            result = JSON.parse(cleaned);
        } catch {
            throw new Error(`AI returned invalid JSON. Raw: ${raw}`);
        }

        return result;
    }
}
