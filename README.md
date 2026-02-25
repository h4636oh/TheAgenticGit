# 🤖 TheAgenticGit

Welcome to **TheAgenticGit**, an agentic AI-powered Git assistant implemented as a Visual Studio Code extension. This project was built to rethink how developers interact with their version control system by automating complex Git workflows using Large Language Models (LLMs).

This README serves as a comprehensive guide to understanding the project, explicitly tailored to explain the **Architecture** and **Internal Workings** for your BTP (B.Tech Project) presentation.

---

## ✨ Key Features

1. **🧠 Natural Language Git (WorkflowAgent)**: Ask the assistant to "undo my last commit without losing changes" or "squash the last 3 commits," and it will plan and execute the correct Git commands.
2. **✨ Smart Commits (CommitAnalyzer)**: Analyzes your staged/unstaged diffs and automatically generates meaningful, conventional commit messages.
3. **👀 AI Code Review (CodeReviewer)**: Reviews your current changes for bugs, security issues, and style violations before you commit.
4. **🌿 Intelligent Branch Naming (BranchManager)**: Suggests clean, standard branch names based on a brief description of the feature or fix you are building.
5. **⚔️ Conflict Resolution (ConflictResolver)**: Intelligently resolves Git merge conflicts by understanding the context of both incoming and current changes.
6. **✂️ Atomic Commit Splitting (AtomicCommitHelper)**: Looks at a massive tangled diff and logically splits it into smaller, atomic commits (e.g., separating formatting changes from logic changes).
7. **🔌 Multi-Provider Support**: Pluggable AI backend supporting **Local Models (Ollama)** for privacy, as well as OpenAI, Anthropic, and Gemini.

---

## 🏗️ Architecture Overview

TheAgenticGit follows a modular, three-tier architecture within the VS Code Extension Host environment.

### 1. Presentation Layer (WebView & VS Code UI)
- **`src/webview/SidebarProvider.ts`**: The bridge between VS Code and the custom UI. It hosts an HTML/React/JS webview inside the VS Code Activity Bar.
- **Message Passing**: The UI cannot run Node.js code natively. It communicates with the Extension Host by sending JSON messages (e.g., `{ type: 'planCommand', prompt: '...' }`). `SidebarProvider.ts` listens to these events, executes the logic, and posts the results back to the webview.
- **VS Code Commands**: Registered in `extension.ts` (e.g., `theAgenticGit.smartCommit`). These trigger native VS Code notifications, progress bars, and quick picks.

### 2. Service Orchestration Layer (The "Agents")
Located in `src/git/`, this layer contains the specific business logic for each feature. These agents orchestrate the data flow between the AI and the Git repository:
- **`GitService.ts`**: A robust wrapper around the local Git CLI. It uses `child_process.exec` to run Git commands securely, read diffs, stages, stashes, and commit histories.
- **`WorkflowAgent.ts`**: Takes a natural language request, asks the AI to generate a sequence of Git commands (a "Plan"), and then safely executes them.
- **`CommitAnalyzer.ts`, `CodeReviewer.ts`, `BranchManager.ts`, `ConflictResolver.ts`, `AtomicCommitHelper.ts`**: Each focuses on a highly specific task. They gather the exact Git context needed (e.g., resolving diffs with markers `<<<<<<<`) and use strict system prompts to get reliable JSON responses from the AI.

### 3. AI Abstraction Layer
Located in `src/ai/`, this layer ensures the extension is completely model-agnostic.
- **`ProviderFactory.ts`**: A factory pattern implementation that reads user settings and instantiates the correct AI provider class.
- **`ModelProvider.ts` (Interface)**: Defines the standard contract (`listModels()`, `chat()`) that every provider must implement.
- **`providers/`**: Implementations for `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, and `OllamaProvider` (supporting completely offline, private AI execution).

### 4. Security & Storage
- **`SecretStorageService.ts`**: Uses VS Code's native `SecretStorage` API to securely store API keys in the OS keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service) rather than plaintext files.

---

## 🔄 Data Flow: How a Feature Works

Let's trace the data flow for the **"Smart Commit"** feature to understand exactly what happens under the hood:

1. **Trigger**: The user clicks the "Generate Smart Commit Message" button in the Sidebar or presses `Ctrl+Shift+G Ctrl+Shift+C`.
2. **Context Gathering**: The command invokes `CommitAnalyzer.suggest()`. The analyzer calls `GitService.getFullDiff()` to extract all staged and unstaged changes in the repo.
3. **AI Request**: The `CommitAnalyzer` builds a specialized prompt containing the diff and sends it to the AI through the `ProviderFactory` (e.g., Ollama running locally).
4. **AI Processing**: The LLM processes the diff and returns a structured response matching conventional commit formats (e.g., `feat: added authentication`).
5. **Human-in-the-Loop (HITL)**: `extension.ts` displays a VS Code Information Message popping up with the suggested commit message, giving the user options to "Apply Commit", "Copy to Clipboard", or "Dismiss". *(We never execute destructive actions without user approval).*
6. **Execution**: If the user clicks "Apply Commit", `GitService.commit()` is called, which executes `git commit -m "..."`. The Sidebar is then automatically updated with the new repository status via `SidebarProvider`.

---

## 💡 Why this is a Great BTP

This project demonstrates several advanced Software Engineering concepts:
- **Agentic AI**: Moving beyond standard chatbots by allowing AI to formulate step-by-step plans and execute system commands in a sandbox.
- **Plugin Architecture**: The `ProviderFactory` demonstrates strict adherence to the Open-Closed Principle (SOLID). Adding a new AI model in the future requires zero changes to the core logic.
- **Secure System Interaction**: Managing stateful interactions with the system CLI (`git`) asynchronously while preventing command injection.
- **UX/UI Inter-Process Communication (IPC)**: Managing asynchronous message passing between a sandboxed Webview and the Node.js Extension Host.

---

## 🛠️ Setup & Development Local 

To run this locally or demonstrate it during your presentation:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Compile the Extension**:
   ```bash
   npm run compile
   # Or run 'npm run watch' for hot-reloading
   ```

3. **Run in VS Code**:
   - Press `F5` in VS Code to open a new "Extension Development Host" window with TheAgenticGit loaded.
   - Open any Git repository in that new window.
   - Click the "TheAgenticGit" icon in the Activity Bar (Sidebar) to begin using the AI!

4. **Local AI Setup (Optional but heavily recommended for privacy)**:
   - Install [Ollama](https://ollama.com/) locally.
   - Run `ollama run llama3.2` or `ollama run mistral`.
   - The extension will automatically connect to `localhost:11434` and use your local models for free!
