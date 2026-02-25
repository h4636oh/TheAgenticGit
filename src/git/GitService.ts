import * as vscode from 'vscode';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitCommit {
    hash: string;
    subject: string;
    author: string;
    date: string;
}

export interface FileDiff {
    path: string;
    status: string; // M, A, D, R
    diff: string;
}

export class GitService {
    private repoPath: string;

    constructor(repoPath?: string) {
        this.repoPath = repoPath || this.detectRepoPath();
    }

    private detectRepoPath(): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder open. Please open a Git repository.');
        }
        return workspaceFolders[0].uri.fsPath;
    }

    private git(args: string): string {
        return execSync(`git -C "${this.repoPath}" ${args}`, {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
        }).trim();
    }

    async isGitRepo(): Promise<boolean> {
        try {
            this.git('rev-parse --git-dir');
            return true;
        } catch {
            return false;
        }
    }

    async getCurrentBranch(): Promise<string> {
        return this.git('branch --show-current');
    }

    async listBranches(): Promise<string[]> {
        const output = this.git('branch -a --format=%(refname:short)');
        return output.split('\n').filter(Boolean);
    }

    async getStagedDiff(): Promise<string> {
        return this.git('diff --cached');
    }

    async getUnstagedDiff(): Promise<string> {
        return this.git('diff');
    }

    async getFullDiff(): Promise<string> {
        const staged = await this.getStagedDiff();
        const unstaged = await this.getUnstagedDiff();
        return [staged, unstaged].filter(Boolean).join('\n');
    }

    async getStagedFiles(): Promise<FileDiff[]> {
        const output = this.git('diff --cached --name-status');
        const files: FileDiff[] = [];

        for (const line of output.split('\n').filter(Boolean)) {
            const [status, ...pathParts] = line.split('\t');
            const path = pathParts.join('\t');
            let diff = '';
            try {
                diff = this.git(`diff --cached -- "${path}"`);
            } catch {
                diff = '';
            }
            files.push({ path, status: status.trim(), diff });
        }

        return files;
    }

    async getLog(n: number = 20): Promise<GitCommit[]> {
        const output = this.git(`log -n ${n} --pretty=format:"%H|%s|%an|%ai"`);
        return output.split('\n').filter(Boolean).map(line => {
            const [hash, subject, author, date] = line.split('|');
            return { hash, subject, author, date };
        });
    }

    async getStatus(): Promise<string> {
        return this.git('status --short');
    }

    async getStashes(): Promise<string[]> {
        const output = this.git('stash list');
        return output.split('\n').filter(Boolean);
    }

    async getConflictedFiles(): Promise<string[]> {
        const output = this.git('diff --name-only --diff-filter=U');
        return output.split('\n').filter(Boolean);
    }

    async readFileContent(filePath: string): Promise<string> {
        const { stdout } = await execAsync(`cat "${this.repoPath}/${filePath}"`);
        return stdout;
    }

    async runCommand(command: string): Promise<{ stdout: string; stderr: string }> {
        const fullCommand = `git -C "${this.repoPath}" ${command}`;
        return execAsync(fullCommand);
    }

    async stageFile(filePath: string): Promise<void> {
        await this.runCommand(`add "${filePath}"`);
    }

    async unstageFile(filePath: string): Promise<void> {
        await this.runCommand(`restore --staged "${filePath}"`);
    }

    async commit(message: string): Promise<void> {
        await this.runCommand(`commit -m "${message.replace(/"/g, '\\"')}"`);
    }

    getRepoPath(): string {
        return this.repoPath;
    }
}
