import * as vscode from 'vscode';
import { SidebarProvider } from './webview/SidebarProvider';
import { ProviderFactory } from './ai/ProviderFactory';
import { GitService } from './git/GitService';
import { CommitAnalyzer } from './git/CommitAnalyzer';
import { BranchManager } from './git/BranchManager';
import { ConflictResolver } from './git/ConflictResolver';
import { AtomicCommitHelper } from './git/AtomicCommitHelper';
import { CodeReviewer } from './git/CodeReviewer';

export function activate(context: vscode.ExtensionContext) {
    // Register the sidebar panel
    const sidebarProvider = new SidebarProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider),
    );

    // ── Command: Open Panel ──────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('theAgenticGit.openPanel', () => {
            vscode.commands.executeCommand('theAgenticGit.sidebar.focus');
        })
    );

    // ── Command: Smart Commit ─────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('theAgenticGit.smartCommit', async () => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'TheAgenticGit: Generating commit message...', cancellable: false },
                async () => {
                    try {
                        const ai = await ProviderFactory.create(context);
                        const git = new GitService();
                        const analyzer = new CommitAnalyzer(ai, git);
                        const suggestion = await analyzer.suggest();

                        const choice = await vscode.window.showInformationMessage(
                            `💡 Suggested commit:\n${suggestion.fullMessage}`,
                            { modal: true },
                            'Apply Commit',
                            'Copy to Clipboard',
                            'Dismiss',
                        );

                        if (choice === 'Apply Commit') {
                            await git.commit(suggestion.fullMessage);
                            vscode.window.showInformationMessage('✓ Commit applied!');
                        } else if (choice === 'Copy to Clipboard') {
                            await vscode.env.clipboard.writeText(suggestion.fullMessage);
                            vscode.window.showInformationMessage('✓ Commit message copied!');
                        }
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`TheAgenticGit: ${err.message}`);
                    }
                }
            );
        })
    );

    // ── Command: AI Code Review ──────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('theAgenticGit.reviewDiff', async () => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'TheAgenticGit: Reviewing diff...', cancellable: false },
                async () => {
                    try {
                        const ai = await ProviderFactory.create(context);
                        const git = new GitService();
                        const reviewer = new CodeReviewer(ai, git);
                        const review = await reviewer.review('staged');

                        // Show review in output channel
                        const channel = vscode.window.createOutputChannel('TheAgenticGit Review');
                        channel.clear();
                        channel.appendLine('═══════════════════════════════════════');
                        channel.appendLine('  TheAgenticGit — AI Code Review');
                        channel.appendLine('═══════════════════════════════════════');
                        channel.appendLine('');
                        channel.appendLine(`📋 SUMMARY`);
                        channel.appendLine(`  ${review.summary}`);
                        channel.appendLine('');
                        channel.appendLine(`🏁 VERDICT: ${review.verdict.toUpperCase()}`);
                        channel.appendLine('');

                        if (review.findings.length > 0) {
                            channel.appendLine('🔍 FINDINGS');
                            for (const f of review.findings) {
                                const icon = f.severity === 'error' ? '❌' : f.severity === 'warning' ? '⚠️ ' : 'ℹ️ ';
                                channel.appendLine(`  ${icon} [${f.severity.toUpperCase()}] ${f.file}${f.line ? ` (${f.line})` : ''}`);
                                channel.appendLine(`     ${f.message}`);
                            }
                        } else {
                            channel.appendLine('✅ No issues found.');
                        }

                        channel.show();
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`TheAgenticGit: ${err.message}`);
                    }
                }
            );
        })
    );

    // ── Command: Suggest Branch Name ──────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('theAgenticGit.suggestBranch', async () => {
            const description = await vscode.window.showInputBox({
                prompt: 'Describe the feature or fix for this branch',
                placeHolder: 'e.g., "Add user authentication with JWT tokens"',
            });

            if (!description) { return; }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'TheAgenticGit: Generating branch names...', cancellable: false },
                async () => {
                    try {
                        const ai = await ProviderFactory.create(context);
                        const manager = new BranchManager(ai);
                        const suggestions = await manager.suggest(description);

                        const items = suggestions.map(s => ({
                            label: s.name,
                            description: s.rationale,
                        }));

                        const picked = await vscode.window.showQuickPick(items, {
                            title: 'Select a branch name',
                            placeHolder: 'Choose or dismiss',
                        });

                        if (picked) {
                            const create = await vscode.window.showInformationMessage(
                                `Create branch: ${picked.label}?`, 'Create', 'Copy Only'
                            );
                            if (create === 'Create') {
                                const git = new GitService();
                                await git.runCommand(`checkout -b "${picked.label}"`);
                                vscode.window.showInformationMessage(`✓ Branch created: ${picked.label}`);
                            } else if (create === 'Copy Only') {
                                await vscode.env.clipboard.writeText(picked.label);
                            }
                        }
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`TheAgenticGit: ${err.message}`);
                    }
                }
            );
        })
    );

    // ── Command: Resolve Merge Conflicts ──────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('theAgenticGit.resolveConflicts', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'TheAgenticGit will use AI to resolve ALL merge conflicts. This will overwrite conflicted files. Continue?',
                { modal: true },
                'Resolve All',
            );
            if (confirm !== 'Resolve All') { return; }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'TheAgenticGit: Resolving conflicts...', cancellable: false },
                async (progress) => {
                    try {
                        const ai = await ProviderFactory.create(context);
                        const git = new GitService();
                        const resolver = new ConflictResolver(ai, git);
                        const resolutions = await resolver.resolveAll();

                        for (const res of resolutions) {
                            progress.report({ message: `Applying ${res.filePath}...` });
                            await resolver.applyResolution(res);
                        }

                        vscode.window.showInformationMessage(
                            `✓ Resolved ${resolutions.length} conflicted file(s). Review changes before committing.`
                        );
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`TheAgenticGit: ${err.message}`);
                    }
                }
            );
        })
    );

    // ── Command: Atomic Commit Splitter ───────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('theAgenticGit.atomicCommits', async () => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'TheAgenticGit: Analyzing changes for atomic commits...', cancellable: false },
                async () => {
                    try {
                        const ai = await ProviderFactory.create(context);
                        const git = new GitService();
                        const helper = new AtomicCommitHelper(ai, git);
                        const plan = await helper.analyze();

                        const channel = vscode.window.createOutputChannel('TheAgenticGit Atomic Commits');
                        channel.clear();
                        channel.appendLine('═══════════════════════════════════════');
                        channel.appendLine('  TheAgenticGit — Atomic Commit Plan');
                        channel.appendLine('═══════════════════════════════════════');
                        channel.appendLine('');
                        channel.appendLine(plan.summary);
                        channel.appendLine('');

                        for (let i = 0; i < plan.groups.length; i++) {
                            const g = plan.groups[i];
                            channel.appendLine(`Commit ${i + 1}: ${g.commitMessage}`);
                            channel.appendLine(`  Files: ${g.files.join(', ')}`);
                            channel.appendLine(`  Why: ${g.rationale}`);
                            channel.appendLine('');
                        }

                        channel.show();

                        const confirm = await vscode.window.showInformationMessage(
                            `Ready to create ${plan.groups.length} atomic commits. See "TheAgenticGit Atomic Commits" output for details.`,
                            { modal: true },
                            'Execute Plan',
                            'Cancel',
                        );

                        if (confirm === 'Execute Plan') {
                            const results = await helper.execute(plan);
                            const channel2 = vscode.window.createOutputChannel('TheAgenticGit Atomic Commits');
                            channel2.appendLine('\n── Execution Results ──');
                            results.forEach(r => channel2.appendLine(r));
                            channel2.show();
                            vscode.window.showInformationMessage(`✓ Created ${plan.groups.length} atomic commits!`);
                        }
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`TheAgenticGit: ${err.message}`);
                    }
                }
            );
        })
    );

    vscode.window.showInformationMessage('TheAgenticGit is active ✓');
}

export function deactivate() { }
