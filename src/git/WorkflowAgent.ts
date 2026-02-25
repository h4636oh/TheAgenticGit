import * as vscode from 'vscode';
import { ModelProvider } from '../ai/ModelProvider';
import { GitService } from './GitService';

export interface GitPlan {
    description: string;
    reasoning: string;
    commands: GitCommand[];
    warnings: string[];
}

export interface GitCommand {
    command: string;     // e.g. "git commit -m '...'"
    description: string; // human-readable explanation
    dangerous: boolean;  // if true, show extra warning
    args: string;        // just the args part for GitService.runCommand
}

const SYSTEM_PROMPT = `You are an expert Git assistant. When given a natural language git request, 
you must respond ONLY with a valid JSON object (no markdown, no explanation, no code fences).

The JSON schema is:
{
  "description": "short summary of what this plan does",
  "reasoning": "why these commands accomplish the goal",
  "commands": [
    {
      "command": "full git command string including 'git'",
      "args": "args only, without the leading 'git '",
      "description": "plain English explanation of this step",
      "dangerous": false
    }
  ],
  "warnings": ["any important warnings or caveats"]
}

Commands must be safe, standard git operations. Never use --force unless explicitly asked.
Mark destructive operations (reset --hard, clean -fd, etc.) with dangerous: true.
`;

export class WorkflowAgent {
    constructor(
        private provider: ModelProvider,
        private gitService: GitService,
    ) { }

    async plan(userRequest: string): Promise<GitPlan> {
        const branch = await this.gitService.getCurrentBranch();
        const status = await this.gitService.getStatus();
        const recentLog = (await this.gitService.getLog(5))
            .map(c => `  ${c.hash.substring(0, 7)} ${c.subject}`)
            .join('\n');

        const userPrompt = `
Repository state:
- Current branch: ${branch}
- Git status:
${status || '(clean)'}
- Recent commits:
${recentLog || '(none)'}

User request: "${userRequest}"

Respond with the JSON plan only.
    `.trim();

        const raw = await this.provider.complete(SYSTEM_PROMPT, userPrompt);

        // Strip markdown code fences if the model wraps them anyway
        const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

        let plan: GitPlan;
        try {
            plan = JSON.parse(cleaned);
        } catch (e) {
            throw new Error(`AI returned invalid JSON. Raw response:\n\n${raw}`);
        }

        return plan;
    }

    async execute(plan: GitPlan, webview?: vscode.WebviewView): Promise<string[]> {
        const results: string[] = [];

        for (const cmd of plan.commands) {
            const label = `Running: git ${cmd.args}`;
            webview?.webview.postMessage({ type: 'execStep', label });

            try {
                const { stdout, stderr } = await this.gitService.runCommand(cmd.args);
                const output = [stdout, stderr].filter(Boolean).join('\n');
                results.push(`✓ ${cmd.description}\n${output}`.trim());
            } catch (err: any) {
                results.push(`✗ ${cmd.description}\nError: ${err.message}`);
                throw new Error(`Command failed: git ${cmd.args}\n${err.message}`);
            }
        }

        return results;
    }
}
