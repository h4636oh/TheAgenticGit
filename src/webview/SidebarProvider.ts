import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProviderFactory } from '../ai/ProviderFactory';
import { SecretStorageService } from '../services/SecretStorageService';
import { GitService } from '../git/GitService';
import { WorkflowAgent } from '../git/WorkflowAgent';
import { CommitAnalyzer } from '../git/CommitAnalyzer';
import { BranchManager } from '../git/BranchManager';
import { ConflictResolver } from '../git/ConflictResolver';
import { AtomicCommitHelper } from '../git/AtomicCommitHelper';
import { CodeReviewer } from '../git/CodeReviewer';
import { OllamaProvider } from '../ai/providers/OllamaProvider';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'theAgenticGit.sidebar';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
    ) { }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            try {
                await this._handleMessage(msg, webviewView);
            } catch (err: any) {
                webviewView.webview.postMessage({
                    type: 'error',
                    requestId: msg.requestId,
                    message: err.message || String(err),
                });
            }
        });
    }

    private async _handleMessage(msg: any, view: vscode.WebviewView) {
        const { type, requestId } = msg;

        switch (type) {
            // ── Settings ──────────────────────────────────────────────────────────
            case 'saveApiKey': {
                const secretService = new SecretStorageService(this._context);
                await secretService.storeApiKey(msg.provider, msg.key);
                view.webview.postMessage({ type: 'apiKeySaved', requestId, provider: msg.provider });
                break;
            }

            case 'checkApiKeys': {
                const secretService = new SecretStorageService(this._context);
                const providers = ['openai', 'anthropic', 'gemini', 'ollama'];
                const keyStatus: Record<string, boolean> = {};
                for (const p of providers) {
                    keyStatus[p] = await secretService.hasApiKey(p);
                }
                view.webview.postMessage({ type: 'apiKeyStatus', requestId, keyStatus });
                break;
            }

            case 'getConfig': {
                const config = vscode.workspace.getConfiguration('theAgenticGit');
                view.webview.postMessage({
                    type: 'config',
                    requestId,
                    provider: config.get('provider', 'ollama'),
                    model: config.get('model', ''),
                    ollamaBaseUrl: config.get('ollamaBaseUrl', 'http://localhost:11434'),
                    requireApproval: config.get('requireApprovalBeforeExecute', true),
                });
                break;
            }

            case 'setProvider': {
                await vscode.workspace.getConfiguration('theAgenticGit').update(
                    'provider', msg.provider, vscode.ConfigurationTarget.Global
                );
                view.webview.postMessage({ type: 'providerSet', requestId, provider: msg.provider });
                break;
            }

            case 'setModel': {
                await vscode.workspace.getConfiguration('theAgenticGit').update(
                    'model', msg.model, vscode.ConfigurationTarget.Global
                );
                view.webview.postMessage({ type: 'modelSet', requestId });
                break;
            }

            case 'listModels': {
                const config = vscode.workspace.getConfiguration('theAgenticGit');
                const provider = msg.provider ?? config.get('provider', 'ollama');
                let models: string[] = [];

                if (provider === 'ollama') {
                    const baseUrl = config.get('ollamaBaseUrl', 'http://localhost:11434');
                    const ollama = new OllamaProvider(baseUrl as string);
                    models = await ollama.listModels();
                } else {
                    const ai = await ProviderFactory.create(this._context);
                    models = await ai.listModels();
                }

                view.webview.postMessage({ type: 'modelList', requestId, models });
                break;
            }

            // ── Workflow Agent ──────────────────────────────────────────────────
            case 'planCommand': {
                const ai = await ProviderFactory.create(this._context);
                const git = new GitService();
                const agent = new WorkflowAgent(ai, git);
                const plan = await agent.plan(msg.prompt);
                view.webview.postMessage({ type: 'plan', requestId, plan });
                break;
            }

            case 'executeCommand': {
                const ai = await ProviderFactory.create(this._context);
                const git = new GitService();
                const agent = new WorkflowAgent(ai, git);
                const results = await agent.execute(msg.plan, view);
                view.webview.postMessage({ type: 'executeResult', requestId, results });
                break;
            }

            // ── Smart Commit ─────────────────────────────────────────────────────
            case 'generateCommit': {
                const ai = await ProviderFactory.create(this._context);
                const git = new GitService();
                const analyzer = new CommitAnalyzer(ai, git);
                const suggestion = await analyzer.suggest();
                view.webview.postMessage({ type: 'commitSuggestion', requestId, suggestion });
                break;
            }

            case 'applyCommit': {
                const git = new GitService();
                await git.commit(msg.message);
                view.webview.postMessage({ type: 'commitApplied', requestId });
                break;
            }

            // ── Code Review ──────────────────────────────────────────────────────
            case 'reviewCode': {
                const ai = await ProviderFactory.create(this._context);
                const git = new GitService();
                const reviewer = new CodeReviewer(ai, git);
                const review = await reviewer.review(msg.target ?? 'staged');
                view.webview.postMessage({ type: 'reviewResult', requestId, review });
                break;
            }

            // ── Branch Manager ────────────────────────────────────────────────────
            case 'suggestBranch': {
                const ai = await ProviderFactory.create(this._context);
                const manager = new BranchManager(ai);
                const suggestions = await manager.suggest(msg.description);
                view.webview.postMessage({ type: 'branchSuggestions', requestId, suggestions });
                break;
            }

            case 'createBranch': {
                const git = new GitService();
                await git.runCommand(`checkout -b "${msg.name}"`);
                view.webview.postMessage({ type: 'branchCreated', requestId, name: msg.name });
                break;
            }

            // ── Conflict Resolver ─────────────────────────────────────────────────
            case 'resolveConflicts': {
                const ai = await ProviderFactory.create(this._context);
                const git = new GitService();
                const resolver = new ConflictResolver(ai, git);
                const resolutions = await resolver.resolveAll();
                view.webview.postMessage({ type: 'conflictResolutions', requestId, resolutions });
                break;
            }

            case 'applyResolution': {
                const ai = await ProviderFactory.create(this._context);
                const git = new GitService();
                const resolver = new ConflictResolver(ai, git);
                await resolver.applyResolution(msg.resolution);
                view.webview.postMessage({ type: 'resolutionApplied', requestId, filePath: msg.resolution.filePath });
                break;
            }

            // ── Atomic Commits ────────────────────────────────────────────────────
            case 'analyzeAtomic': {
                const ai = await ProviderFactory.create(this._context);
                const git = new GitService();
                const helper = new AtomicCommitHelper(ai, git);
                const plan = await helper.analyze();
                view.webview.postMessage({ type: 'atomicPlan', requestId, plan });
                break;
            }

            case 'executeAtomic': {
                const ai = await ProviderFactory.create(this._context);
                const git = new GitService();
                const helper = new AtomicCommitHelper(ai, git);
                const results = await helper.execute(msg.plan);
                view.webview.postMessage({ type: 'atomicResult', requestId, results });
                break;
            }

            // ── Repo Status ─────────────────────────────────────────────────────
            case 'getRepoStatus': {
                const git = new GitService();
                const [branch, status, stashes, log, conflicted] = await Promise.all([
                    git.getCurrentBranch(),
                    git.getStatus(),
                    git.getStashes(),
                    git.getLog(10),
                    git.getConflictedFiles(),
                ]);
                view.webview.postMessage({
                    type: 'repoStatus',
                    requestId,
                    branch,
                    status,
                    stashes,
                    log,
                    conflicted,
                });
                break;
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const uiPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'ui');
        const htmlPath = path.join(uiPath.fsPath, 'index.html');

        let html = fs.readFileSync(htmlPath, 'utf8');

        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(uiPath, 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(uiPath, 'styles.css'));

        // Generate a one-time nonce for the CSP
        const nonce = this._getNonce();

        html = html
            .replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
            .replace(/\{\{styleUri\}\}/g, styleUri.toString())
            .replace(/\{\{nonce\}\}/g, nonce)
            .replace(/\{\{cspSource\}\}/g, webview.cspSource);

        return html;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    public postMessage(msg: any) {
        this._view?.webview.postMessage(msg);
    }
}
