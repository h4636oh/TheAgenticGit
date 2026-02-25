import { ModelProvider } from '../ai/ModelProvider';
import { GitService, FileDiff } from './GitService';

export interface AtomicGroup {
    name: string;
    commitMessage: string;
    files: string[];
    rationale: string;
}

export interface AtomicSplitPlan {
    groups: AtomicGroup[];
    summary: string;
}

const SYSTEM_PROMPT = `You are an expert at decomposing large changesets into atomic, focused commits.
Each atomic commit should represent a single logical change — one reason to change.

Given a list of changed files with their diffs, group them into atomic commit groups.
Respond ONLY with a JSON object — no markdown, no explanation, no code fences.

Schema:
{
  "summary": "brief overview of what the split accomplishes",
  "groups": [
    {
      "name": "short commit group name",
      "commitMessage": "conventional commit message for this group",
      "files": ["relative/path/to/file.ts", ...],
      "rationale": "why these files belong together"
    }
  ]
}

Rules:
- Each group should have ONE clear purpose
- Use conventional commit format: type(scope): subject
- Files with related functionality belong together
- Separate refactoring from features, tests from implementation
- Aim for 2-6 groups; avoid creating more than 8
- Every changed file must appear in exactly one group
`;

export class AtomicCommitHelper {
    constructor(
        private provider: ModelProvider,
        private gitService: GitService,
    ) { }

    async analyze(): Promise<AtomicSplitPlan> {
        const files = await this.gitService.getStagedFiles();

        if (files.length === 0) {
            // Try unstaged
            const status = await this.gitService.getStatus();
            if (!status || status.trim().length === 0) {
                throw new Error('No changes found. The working tree is clean.');
            }
            throw new Error('No staged changes. Stage your changes with `git add` before splitting into atomic commits.');
        }

        if (files.length === 1) {
            // Only one file — just suggest a commit message
            const diff = files[0].diff;
            const singleGroupMessage = `Only one file changed (${files[0].path}). No splitting needed — just commit it!`;
            return {
                summary: singleGroupMessage,
                groups: [{
                    name: 'all changes',
                    commitMessage: 'chore: update file',
                    files: [files[0].path],
                    rationale: 'Single file change requires no splitting.',
                }],
            };
        }

        // Build a concise summary of each file's changes
        const fileSummaries = files.map(f => {
            const truncatedDiff = f.diff.length > 1500 ? f.diff.substring(0, 1500) + '\n...(truncated)' : f.diff;
            return `File: ${f.path} (status: ${f.status})\nDiff:\n${truncatedDiff}`;
        }).join('\n\n---\n\n');

        const maxLen = 12000;
        const prompt = fileSummaries.length > maxLen
            ? fileSummaries.substring(0, maxLen) + '\n... (truncated)'
            : fileSummaries;

        const raw = await this.provider.complete(SYSTEM_PROMPT, prompt);
        const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

        let result: AtomicSplitPlan;
        try {
            result = JSON.parse(cleaned);
        } catch {
            throw new Error(`AI returned invalid JSON. Raw: ${raw}`);
        }

        return result;
    }

    /**
     * Execute the atomic commit plan:
     * - For each group: unstage all, stage only group files, commit.
     */
    async execute(plan: AtomicSplitPlan): Promise<string[]> {
        const results: string[] = [];

        // First, stash everything to a clean state (or use index manipulation)
        // Strategy: unstage all, then for each group, stage & commit
        await this.gitService.runCommand('restore --staged .');

        for (const group of plan.groups) {
            // Stage only this group's files
            for (const file of group.files) {
                try {
                    await this.gitService.stageFile(file);
                } catch (e: any) {
                    results.push(`⚠ Could not stage ${file}: ${e.message}`);
                }
            }

            // Commit
            try {
                await this.gitService.commit(group.commitMessage);
                results.push(`✓ Committed: ${group.commitMessage}\n  Files: ${group.files.join(', ')}`);
            } catch (e: any) {
                results.push(`✗ Failed to commit group "${group.name}": ${e.message}`);
                throw e;
            }
        }

        return results;
    }
}
