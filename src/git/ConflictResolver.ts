import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModelProvider } from '../ai/ModelProvider';
import { GitService } from './GitService';

export interface ConflictResolution {
    filePath: string;
    resolvedContent: string;
    explanation: string;
}

const SYSTEM_PROMPT = `You are an expert Git merge conflict resolver.
Given a file with conflict markers, produce a resolved version by intelligently merging both sides.
Respond ONLY with a JSON object — no markdown, no code fences.

Schema:
{
  "resolvedContent": "the full file content with conflicts resolved",
  "explanation": "1-2 sentence explanation of how you resolved the conflicts"
}

Rules:
- Preserve ALL code that is not part of the conflict
- For each conflict, choose the best resolution — sometimes HEAD, sometimes incoming, sometimes both
- If both changes are independent (different lines), keep both
- If they are semantically equivalent, keep the cleaner version
- The resolvedContent must have NO conflict markers remaining
`;

export class ConflictResolver {
    constructor(
        private provider: ModelProvider,
        private gitService: GitService,
    ) { }

    async resolveFile(filePath: string): Promise<ConflictResolution> {
        const fullPath = path.join(this.gitService.getRepoPath(), filePath);
        const content = fs.readFileSync(fullPath, 'utf8');

        if (!content.includes('<<<<<<<')) {
            throw new Error(`No conflict markers found in ${filePath}`);
        }

        const truncated = content.length > 8000
            ? content.substring(0, 8000) + '\n... (truncated)'
            : content;

        const raw = await this.provider.complete(
            SYSTEM_PROMPT,
            `File: ${filePath}\n\nContent with conflicts:\n${truncated}`
        );

        const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

        let result: any;
        try {
            result = JSON.parse(cleaned);
        } catch {
            throw new Error(`AI returned invalid JSON. Raw: ${raw}`);
        }

        return {
            filePath,
            resolvedContent: result.resolvedContent,
            explanation: result.explanation,
        };
    }

    async applyResolution(resolution: ConflictResolution): Promise<void> {
        const fullPath = path.join(this.gitService.getRepoPath(), resolution.filePath);
        fs.writeFileSync(fullPath, resolution.resolvedContent, 'utf8');
        await this.gitService.stageFile(resolution.filePath);
    }

    async resolveAll(): Promise<ConflictResolution[]> {
        const conflictedFiles = await this.gitService.getConflictedFiles();
        if (conflictedFiles.length === 0) {
            throw new Error('No conflicted files found in the repository.');
        }

        const resolutions: ConflictResolution[] = [];
        for (const file of conflictedFiles) {
            const res = await this.resolveFile(file);
            resolutions.push(res);
        }
        return resolutions;
    }
}
