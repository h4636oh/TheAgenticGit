// @ts-nocheck
(function () {
    const vscode = acquireVsCodeApi();

    // ── State ──────────────────────────────────────────────────────────────
    let currentPlan = null;
    let currentAtomicPlan = null;
    let currentCommitMessage = '';

    // ── Tab navigation ─────────────────────────────────────────────────────
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');

            // Auto-load data when switching to certain tabs
            if (tab.dataset.tab === 'sentinel') loadRepoStatus();
            if (tab.dataset.tab === 'settings') loadSettings();
            if (tab.dataset.tab === 'conflict') loadConflictedFiles();
        });
    });

    // ── Spinner ─────────────────────────────────────────────────────────────
    function showSpinner(label = 'Working...') {
        document.getElementById('spinnerLabel').textContent = label;
        document.getElementById('spinnerOverlay').classList.remove('hidden');
    }
    function hideSpinner() {
        document.getElementById('spinnerOverlay').classList.add('hidden');
    }

    // ── Message bus ─────────────────────────────────────────────────────────
    const pendingRequests = new Map();
    let reqCounter = 0;

    function send(type, payload = {}) {
        const requestId = `req_${++reqCounter}`;
        return new Promise((resolve, reject) => {
            pendingRequests.set(requestId, { resolve, reject });
            vscode.postMessage({ type, requestId, ...payload });
        });
    }

    window.addEventListener('message', ({ data: msg }) => {
        const { requestId, type } = msg;

        // Route to pending request if exists
        if (requestId && pendingRequests.has(requestId)) {
            const { resolve, reject } = pendingRequests.get(requestId);
            pendingRequests.delete(requestId);

            if (type === 'error') {
                reject(new Error(msg.message));
            } else {
                resolve(msg);
            }
            return;
        }

        // Handle push events (no requestId)
        if (type === 'execStep') {
            document.getElementById('spinnerLabel').textContent = msg.label;
        }
    });

    // ── Generic error handler ────────────────────────────────────────────────
    function handleError(err, containerSelector) {
        hideSpinner();
        const container = document.querySelector(containerSelector);
        if (container) {
            container.innerHTML = `<div class="finding finding-error"><span class="finding-header">Error</span><span class="finding-body">${escHtml(err.message)}</span></div>`;
            container.classList.remove('hidden');
        }
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ══════════════════════════════════════════════════════════════════════
    //  SENTINEL TAB
    // ══════════════════════════════════════════════════════════════════════
    async function loadRepoStatus() {
        try {
            const msg = await send('getRepoStatus');
            document.getElementById('currentBranch').textContent = msg.branch || '(detached)';
            document.getElementById('repoStatus').textContent =
                msg.status ? msg.status.split('\n').filter(Boolean).length + ' change(s)' : 'clean';

            // Log
            const logEl = document.getElementById('recentLog');
            logEl.innerHTML = '';
            (msg.log || []).forEach(c => {
                const div = document.createElement('div');
                div.className = 'log-item';
                div.innerHTML = `
          <span class="log-hash">${escHtml(c.hash.substring(0, 7))}</span>
          <span class="log-subject" title="${escHtml(c.subject)}">${escHtml(c.subject)}</span>
          <span class="log-author">${escHtml(c.author)}</span>
        `;
                logEl.appendChild(div);
            });
        } catch (e) {
            document.getElementById('currentBranch').textContent = '(no repo)';
        }
    }

    document.getElementById('btnRefreshStatus').addEventListener('click', () => {
        loadRepoStatus();
    });

    document.getElementById('btnPlan').addEventListener('click', async () => {
        const prompt = document.getElementById('sentinelPrompt').value.trim();
        if (!prompt) { return; }

        showSpinner('Planning...');
        document.getElementById('planCard').classList.add('hidden');
        document.getElementById('sentinelResult').classList.add('hidden');

        try {
            const msg = await send('planCommand', { prompt });
            currentPlan = msg.plan;
            renderPlan(msg.plan);
            hideSpinner();
        } catch (err) {
            handleError(err, '#planCard');
            hideSpinner();
        }
    });

    function renderPlan(plan) {
        document.getElementById('planDescription').textContent = plan.description;

        const warningsEl = document.getElementById('planWarnings');
        if (plan.warnings && plan.warnings.length > 0) {
            warningsEl.textContent = '⚠ ' + plan.warnings.join(' • ');
            warningsEl.classList.remove('hidden');
        } else {
            warningsEl.classList.add('hidden');
        }

        const listEl = document.getElementById('planCommandList');
        listEl.innerHTML = '';
        (plan.commands || []).forEach(cmd => {
            const li = document.createElement('li');
            li.innerHTML = `
        <span class="cmd-text">${escHtml(cmd.command)}</span>
        <span class="cmd-desc">${escHtml(cmd.description)}</span>
        ${cmd.dangerous ? '<span class="cmd-dangerous">⚠ Dangerous operation</span>' : ''}
      `;
            listEl.appendChild(li);
        });

        document.getElementById('planCard').classList.remove('hidden');
    }

    document.getElementById('btnExecute').addEventListener('click', async () => {
        if (!currentPlan) { return; }
        showSpinner('Executing...');
        try {
            const msg = await send('executeCommand', { plan: currentPlan });
            document.getElementById('sentinelResultText').textContent = msg.results.join('\n\n');
            document.getElementById('sentinelResult').classList.remove('hidden');
            document.getElementById('planCard').classList.add('hidden');
            currentPlan = null;
            hideSpinner();
            await loadRepoStatus();
        } catch (err) {
            hideSpinner();
            document.getElementById('sentinelResultText').textContent = '✗ ' + err.message;
            document.getElementById('sentinelResult').classList.remove('hidden');
        }
    });

    document.getElementById('btnDiscardPlan').addEventListener('click', () => {
        currentPlan = null;
        document.getElementById('planCard').classList.add('hidden');
    });

    // ══════════════════════════════════════════════════════════════════════
    //  COMMIT TAB
    // ══════════════════════════════════════════════════════════════════════
    async function generateCommit() {
        showSpinner('Analyzing staged diff...');
        document.getElementById('commitCard').classList.add('hidden');

        try {
            const msg = await send('generateCommit');
            const s = msg.suggestion;
            currentCommitMessage = s.fullMessage;

            document.getElementById('commitTypeBadge').textContent = s.type;
            document.getElementById('commitScopeBadge').textContent = s.scope ? `(${s.scope})` : '';

            const breakingBadge = document.getElementById('commitBreakingBadge');
            s.breaking ? breakingBadge.classList.remove('hidden') : breakingBadge.classList.add('hidden');

            document.getElementById('commitMessageArea').value = s.fullMessage;
            document.getElementById('commitCard').classList.remove('hidden');
            hideSpinner();
        } catch (err) {
            hideSpinner();
            handleError(err, '#commitCard');
        }
    }

    document.getElementById('btnGenerateCommit').addEventListener('click', generateCommit);
    document.getElementById('btnRegenCommit').addEventListener('click', generateCommit);

    document.getElementById('btnApplyCommit').addEventListener('click', async () => {
        const message = document.getElementById('commitMessageArea').value.trim();
        if (!message) { return; }
        showSpinner('Committing...');
        try {
            await send('applyCommit', { message });
            hideSpinner();
            document.getElementById('commitCard').classList.add('hidden');
            await loadRepoStatus();
        } catch (err) {
            hideSpinner();
            alert('Commit failed: ' + err.message);
        }
    });

    document.getElementById('btnCopyCommit').addEventListener('click', () => {
        const msg = document.getElementById('commitMessageArea').value;
        navigator.clipboard.writeText(msg);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  REVIEW TAB
    // ══════════════════════════════════════════════════════════════════════
    async function doReview(target) {
        showSpinner('Reviewing...');
        document.getElementById('reviewCard').classList.add('hidden');

        try {
            const msg = await send('reviewCode', { target });
            const review = msg.review;

            const verdictEl = document.getElementById('reviewVerdict');
            verdictEl.textContent = review.verdict.toUpperCase();
            verdictEl.className = 'verdict-badge';
            if (review.verdict === 'looks good') verdictEl.classList.add('verdict-ok');
            else if (review.verdict === 'minor issues') verdictEl.classList.add('verdict-minor');
            else if (review.verdict === 'needs attention') verdictEl.classList.add('verdict-attn');
            else verdictEl.classList.add('verdict-crit');

            document.getElementById('reviewSummary').textContent = review.summary;

            const findingsEl = document.getElementById('reviewFindings');
            findingsEl.innerHTML = '';
            (review.findings || []).forEach(f => {
                const div = document.createElement('div');
                div.className = `finding finding-${f.severity}`;
                div.innerHTML = `
          <span class="finding-header">${escHtml(f.file)}${f.line ? ` · ${escHtml(f.line)}` : ''}</span>
          <span class="finding-body">${escHtml(f.message)}</span>
        `;
                findingsEl.appendChild(div);
            });
            if (review.findings.length === 0) {
                findingsEl.innerHTML = '<div class="finding finding-info"><span class="finding-body">No issues found ✓</span></div>';
            }

            document.getElementById('reviewCard').classList.remove('hidden');
            hideSpinner();
        } catch (err) {
            hideSpinner();
            handleError(err, '#reviewCard');
        }
    }

    document.getElementById('btnReviewStaged').addEventListener('click', () => doReview('staged'));
    document.getElementById('btnReviewFull').addEventListener('click', () => doReview('full'));

    // ══════════════════════════════════════════════════════════════════════
    //  ATOMIC COMMITS TAB
    // ══════════════════════════════════════════════════════════════════════
    document.getElementById('btnAnalyzeAtomic').addEventListener('click', async () => {
        showSpinner('Analyzing for atomic splitting...');
        document.getElementById('atomicPlanCard').classList.add('hidden');
        document.getElementById('atomicResult').classList.add('hidden');

        try {
            const msg = await send('analyzeAtomic');
            currentAtomicPlan = msg.plan;
            renderAtomicPlan(msg.plan);
            hideSpinner();
        } catch (err) {
            hideSpinner();
            handleError(err, '#atomicPlanCard');
        }
    });

    function renderAtomicPlan(plan) {
        document.getElementById('atomicSummary').textContent = plan.summary;

        const groupsEl = document.getElementById('atomicGroups');
        groupsEl.innerHTML = '';
        plan.groups.forEach((g, i) => {
            const div = document.createElement('div');
            div.className = 'atomic-group';
            div.innerHTML = `
        <div class="atomic-group-msg">${i + 1}. ${escHtml(g.commitMessage)}</div>
        <div class="atomic-group-files">📄 ${escHtml(g.files.join(', '))}</div>
        <div class="atomic-group-why">${escHtml(g.rationale)}</div>
      `;
            groupsEl.appendChild(div);
        });

        document.getElementById('atomicPlanCard').classList.remove('hidden');
    }

    document.getElementById('btnExecuteAtomic').addEventListener('click', async () => {
        if (!currentAtomicPlan) { return; }
        showSpinner('Creating atomic commits...');
        try {
            const msg = await send('executeAtomic', { plan: currentAtomicPlan });
            document.getElementById('atomicResultText').textContent = msg.results.join('\n');
            document.getElementById('atomicResult').classList.remove('hidden');
            document.getElementById('atomicPlanCard').classList.add('hidden');
            currentAtomicPlan = null;
            hideSpinner();
            await loadRepoStatus();
        } catch (err) {
            hideSpinner();
            document.getElementById('atomicResultText').textContent = '✗ ' + err.message;
            document.getElementById('atomicResult').classList.remove('hidden');
        }
    });

    document.getElementById('btnDiscardAtomic').addEventListener('click', () => {
        currentAtomicPlan = null;
        document.getElementById('atomicPlanCard').classList.add('hidden');
    });

    // ══════════════════════════════════════════════════════════════════════
    //  BRANCH TAB
    // ══════════════════════════════════════════════════════════════════════
    document.getElementById('btnSuggestBranch').addEventListener('click', async () => {
        const desc = document.getElementById('branchDescription').value.trim();
        if (!desc) { return; }

        showSpinner('Generating branch names...');
        document.getElementById('branchCard').classList.add('hidden');

        try {
            const msg = await send('suggestBranch', { description: desc });
            renderBranchSuggestions(msg.suggestions);
            hideSpinner();
        } catch (err) {
            hideSpinner();
            handleError(err, '#branchCard');
        }
    });

    function renderBranchSuggestions(suggestions) {
        const listEl = document.getElementById('branchList');
        listEl.innerHTML = '';
        suggestions.forEach(s => {
            const div = document.createElement('div');
            div.className = 'branch-item';
            div.innerHTML = `
        <div class="branch-name">${escHtml(s.name)}</div>
        <div class="branch-rationale">${escHtml(s.rationale)}</div>
        <div class="branch-actions">
          <button class="btn-primary" onclick="createBranch('${escHtml(s.name)}')">Create</button>
          <button class="btn-secondary" onclick="copyText('${escHtml(s.name)}')">Copy</button>
        </div>
      `;
            listEl.appendChild(div);
        });
        document.getElementById('branchCard').classList.remove('hidden');
    }

    window.createBranch = async function (name) {
        showSpinner(`Creating ${name}...`);
        try {
            await send('createBranch', { name });
            hideSpinner();
            await loadRepoStatus();
        } catch (err) {
            hideSpinner();
            alert('Failed: ' + err.message);
        }
    };

    window.copyText = function (text) {
        navigator.clipboard.writeText(text);
    };

    // ══════════════════════════════════════════════════════════════════════
    //  CONFLICT TAB
    // ══════════════════════════════════════════════════════════════════════
    async function loadConflictedFiles() {
        try {
            const msg = await send('getRepoStatus');
            const fileList = document.getElementById('conflictedFileList');
            fileList.innerHTML = '';
            if (msg.conflicted && msg.conflicted.length > 0) {
                msg.conflicted.forEach(f => {
                    const div = document.createElement('div');
                    div.className = 'file-item';
                    div.textContent = f;
                    fileList.appendChild(div);
                });
            } else {
                fileList.innerHTML = '<div class="hint">No conflicted files found.</div>';
            }
        } catch (e) {
            document.getElementById('conflictedFileList').innerHTML = '<div class="hint">(no repo)</div>';
        }
    }

    document.getElementById('btnResolveAll').addEventListener('click', async () => {
        showSpinner('Resolving conflicts...');
        document.getElementById('conflictResult').classList.add('hidden');
        try {
            const msg = await send('resolveConflicts');
            const resolutions = msg.resolutions;

            const resultList = document.getElementById('conflictResultList');
            resultList.innerHTML = '';
            resolutions.forEach(r => {
                const div = document.createElement('div');
                div.className = 'finding finding-info';
                div.innerHTML = `
          <span class="finding-header">✓ ${escHtml(r.filePath)}</span>
          <span class="finding-body">${escHtml(r.explanation)}</span>
          <button class="btn-secondary" style="margin-top:4px;font-size:11px;" onclick="applyResolution(${escHtml(JSON.stringify(r))})">Apply & Stage</button>
        `;
                resultList.appendChild(div);
            });

            document.getElementById('conflictResult').classList.remove('hidden');
            hideSpinner();
        } catch (err) {
            hideSpinner();
            handleError(err, '#conflictResult');
        }
    });

    window.applyResolution = async function (resolution) {
        showSpinner('Applying resolution...');
        try {
            await send('applyResolution', { resolution });
            hideSpinner();
            await loadConflictedFiles();
        } catch (err) {
            hideSpinner();
            alert('Failed: ' + err.message);
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    //  SETTINGS TAB
    // ══════════════════════════════════════════════════════════════════════
    async function loadSettings() {
        const msg = await send('getConfig');
        document.getElementById('providerSelect').value = msg.provider;
        if (msg.ollamaBaseUrl) {
            document.getElementById('ollamaUrlInput').value = msg.ollamaBaseUrl;
        }
        updateProviderUI(msg.provider);
        await refreshModels(msg.provider);
        updateKeyStatus(msg.provider);
    }

    function updateProviderUI(provider) {
        const isOllama = provider === 'ollama';
        document.getElementById('apiKeyGroup').style.display = isOllama ? 'none' : '';
        document.getElementById('ollamaUrlGroup').style.display = isOllama ? '' : 'none';
    }

    async function updateKeyStatus(provider) {
        if (provider === 'ollama') { return; }
        const msg = await send('checkApiKeys');
        const hasKey = msg.keyStatus[provider];
        const statusEl = document.getElementById('keyStatus');
        statusEl.textContent = hasKey ? '✓ saved' : 'not set';
        statusEl.className = 'key-status' + (hasKey ? '' : ' missing');
    }

    async function refreshModels(provider) {
        const modelSelect = document.getElementById('modelSelect');
        modelSelect.innerHTML = '<option>Loading...</option>';
        try {
            const msg = await send('listModels', { provider });
            modelSelect.innerHTML = '';
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = '(use provider default)';
            modelSelect.appendChild(blank);
            (msg.models || []).forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                modelSelect.appendChild(opt);
            });
        } catch {
            modelSelect.innerHTML = '<option value="">(none available)</option>';
        }
    }

    document.getElementById('providerSelect').addEventListener('change', async function () {
        const provider = this.value;
        updateProviderUI(provider);
        await send('setProvider', { provider });
        await refreshModels(provider);
        await updateKeyStatus(provider);
    });

    document.getElementById('modelSelect').addEventListener('change', async function () {
        await send('setModel', { model: this.value });
    });

    document.getElementById('btnRefreshModels').addEventListener('click', async () => {
        const provider = document.getElementById('providerSelect').value;
        await refreshModels(provider);
    });

    document.getElementById('btnSaveKey').addEventListener('click', async () => {
        const provider = document.getElementById('providerSelect').value;
        const key = document.getElementById('apiKeyInput').value.trim();
        if (!key) { return; }
        await send('saveApiKey', { provider, key });
        document.getElementById('apiKeyInput').value = '';
        await updateKeyStatus(provider);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  Init
    // ══════════════════════════════════════════════════════════════════════
    loadRepoStatus();
})();
