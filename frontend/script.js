  const DUMMY_USER = 'Pankaj';
  const DUMMY_PASS = 'Pankaj';

  const authOverlay   = document.getElementById('authOverlay');
  const loginPanel    = document.getElementById('loginPanel');
  const signupPanel   = document.getElementById('signupPanel');
  const loginError    = document.getElementById('loginError');
  const loginErrorText = document.getElementById('loginErrorText');
  const signupError   = document.getElementById('signupError');

  // Auto-skip login if user already logged in this browser session
  if (sessionStorage.getItem('gh_logged_in') === 'true') {
    authOverlay.style.display = 'none';
    document.body.classList.remove('locked');
  }
  const signupErrorText = document.getElementById('signupErrorText');

  function showAuthError(el, textEl, msg) {
    textEl.textContent = msg;
    el.classList.add('active');
    el.classList.remove('hidden');
    setTimeout(() => { el.classList.remove('active'); }, 3500);
  }

  function hideAuthError(el) {
    el.classList.remove('active');
  }

  function handleLogin() {
  const user = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;

  if (user === DUMMY_USER && pass === DUMMY_PASS) {
    sessionStorage.setItem('gh_logged_in', 'true');
    const authOverlay = document.getElementById('authOverlay');
    authOverlay.classList.add('slid-down');

   
    document.body.classList.remove('locked');


    setTimeout(() => {
      authOverlay.style.display = 'none';
    }, 800); 

  } else {
    
    showAuthError(loginError, loginErrorText, "Invalid ");
  }
}


document.getElementById('loginBtn').addEventListener('click', handleLogin);
  function handleSignup() {
    const user = document.getElementById('signupUser').value.trim();
    const pass = document.getElementById('signupPass').value;
    hideAuthError(signupError);

    if (!user || !pass) {
      showAuthError(signupError, signupErrorText, 'Please fill in both fields.');
      return;
    }
  
    document.getElementById('signupUser').value = '';
    document.getElementById('signupPass').value = '';
    showSignupSuccess();
  }

  function showSignupSuccess() {
    switchToLogin();
  
    const successEl = document.createElement('div');
    successEl.className = 'auth-success active';
    successEl.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(0,255,157,0.07);border:1px solid rgba(0,255,157,0.25);color:var(--accent3);padding:10px 14px;border-radius:8px;font-size:11px;margin-bottom:14px;';
    successEl.innerHTML = '<span>Account "not created" — not compleete</span>';
    const body = loginPanel.querySelector('.auth-body');
    body.insertBefore(successEl, body.firstChild);
    setTimeout(() => successEl.remove(), 4000);
  }

  function switchToSignup() {
    loginPanel.classList.add('hidden');
    signupPanel.classList.remove('hidden');
    hideAuthError(loginError);
    document.getElementById('signupUser').focus();
  }

  function switchToLogin() {
    signupPanel.classList.add('hidden');
    loginPanel.classList.remove('hidden');
    hideAuthError(signupError);
    document.getElementById('loginUser').focus();
  }

  function unlockApp() {
   
    authOverlay.style.transition = 'opacity 0.4s ease';
    authOverlay.style.opacity = '0';
    setTimeout(() => {
      authOverlay.style.display = 'none';
      document.body.classList.remove('locked');
    }, 420);
  }

 
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('goSignupBtn').addEventListener('click', switchToSignup);
  document.getElementById('signupBtn').addEventListener('click', handleSignup);
  document.getElementById('goLoginBtn').addEventListener('click', switchToLogin);

 
  document.getElementById('loginUser').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginPass').focus(); });
  document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  document.getElementById('signupUser').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('signupPass').focus(); });
  document.getElementById('signupPass').addEventListener('keydown', e => { if (e.key === 'Enter') handleSignup(); });


  document.getElementById('loginUser').focus();


  const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : window.location.origin;

  let sessionId = null, chatHistory = [], messageCount = 0;
  let isAnalysing = false;

  const FILE_COLORS = {
    py:'#3776AB', js:'#F7DF1E', ts:'#3178C6', jsx:'#61DAFB', tsx:'#61DAFB',
    md:'#6FA9D0', json:'#CB7832', yaml:'#CC3E44', yml:'#CC3E44',
    html:'#E44D26', css:'#264DE4', sh:'#89E051', txt:'#888', toml:'#9C4121'
  };

  document.getElementById('analyseBtn').addEventListener('click', analyseRepo);
  document.getElementById('sendBtn').addEventListener('click', sendChat);
  document.getElementById('clearChatBtn').addEventListener('click', clearChat);
  document.getElementById('copySessionBtn').addEventListener('click', copySession);
  document.getElementById('newRepoBtn').addEventListener('click', resetAnalysis);
  document.getElementById('repoUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); analyseRepo(); } });
  document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });
  document.querySelectorAll('.example-pill').forEach(el => {
    el.addEventListener('click', () => { document.getElementById('repoUrl').value = el.textContent.trim(); document.getElementById('repoUrl').focus(); });
  });
  document.getElementById('suggestionsBar').addEventListener('click', e => {
    if (e.target.classList.contains('suggestion')) { document.getElementById('chatInput').value = e.target.textContent; sendChat(); }
  });

  async function checkApiHealth() {
    try {
      const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        document.getElementById('apiDot').className = 'api-status-dot';
        document.getElementById('apiStatusText').textContent = 'API connected';
      } else throw new Error();
    } catch {
      document.getElementById('apiDot').className = 'api-status-dot offline';
      document.getElementById('apiStatusText').textContent = 'API offline';
    }
  }

  async function safeJson(res) {
    const text = await res.text();
    if (!text || !text.trim()) {
      return { ok: res.ok, data: null, errorMsg: `Server returned empty response (HTTP ${res.status})` };
    }
    try {
      const data = JSON.parse(text);
      const errorMsg = res.ok ? null : (data.detail || data.message || `Server error ${res.status}`);
      return { ok: res.ok, data, errorMsg };
    } catch {
      return { ok: false, data: null, errorMsg: `Server returned non-JSON response (HTTP ${res.status}). Check backend logs.` };
    }
  }

  async function analyseRepo() {
    if (isAnalysing) return;

    let url = document.getElementById('repoUrl').value.trim();
    if (!url) { showToast('Please enter a GitHub URL', 'error'); return; }
    if (!url.startsWith('http')) url = 'https://github.com/' + url;

    isAnalysing = true;
    sessionId = null; chatHistory = []; messageCount = 0;

    hideError(); setLoading(true); showResults(false);
    document.getElementById('analyseBtn').disabled = true;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000000);

    try {
      let res;
      try {
        res = await fetch(`${API}/analyse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: controller.signal
        });
      } catch (networkErr) {
        clearTimeout(timeoutId);
        if (networkErr.name === 'AbortError') {
          throw new Error('Request timed out. Try a smaller repository, or paste the same URL again — embeddings are cached and the second attempt will be instant.');
        }
        throw new Error(`Cannot reach backend at ${API}. Make sure uvicorn is running on port 8000.`);
      }

      clearTimeout(timeoutId);

      const { ok, data, errorMsg } = await safeJson(res);

      if (!ok) throw new Error(errorMsg);
      if (!data) throw new Error('Server returned an empty response.');
      if (!data.session_id) throw new Error('Backend response missing session_id. Check server logs.');

      sessionId = data.session_id;
      renderResults(data);
      showToast('Repository analysed successfully', 'success');

    } catch (err) {
      showError(err.message || 'Failed to analyse repository.');
    } finally {
      isAnalysing = false;
      setLoading(false);
      document.getElementById('analyseBtn').disabled = false;
    }
  }

  const STEPS = [
    { id: 'step1', label: 'Fetching files from GitHub (first run may take 2–5 min)', progress: 20 },
    { id: 'step2', label: 'Chunking and processing files',    progress: 45 },
    { id: 'step3', label: 'Embedding into ChromaDB (heavy — only once per repo)',    progress: 72 },
    { id: 'step4', label: 'Generating AI summary via Groq',      progress: 90 },
  ];
  let stepTimers = [];

  function setLoading(show) {
    document.getElementById('loading').className = show ? 'loading active' : 'loading';
    if (show) {
      document.getElementById('progressFill').style.width = '5%';
      stepTimers.forEach(clearTimeout); stepTimers = [];
      STEPS.forEach((s, i) => {
        const li = document.getElementById(s.id);
        li.className = ''; li.querySelector('.step-icon').textContent = '○';
        const t = setTimeout(() => {
          if (i > 0) {
            const prev = document.getElementById(STEPS[i-1].id);
            prev.className = 'done'; prev.querySelector('.step-icon').textContent = '✓';
          }
          li.className = 'running'; li.querySelector('.step-icon').textContent = '●';
          document.getElementById('progressFill').style.width = s.progress + '%';
          document.getElementById('loadingSubtitle').textContent = s.label;
        }, i * 1400);
        stepTimers.push(t);
      });
    } else {
      stepTimers.forEach(clearTimeout);
      STEPS.forEach(s => {
        const li = document.getElementById(s.id);
        li.className = 'done'; li.querySelector('.step-icon').textContent = '✓';
      });
      document.getElementById('progressFill').style.width = '100%';
    }
  }

  function renderResults(data) {
    const slug = (data.repo_url || '').replace('https://github.com/', '');
    document.getElementById('repoNameText').textContent = slug;

    document.getElementById('statsBar').innerHTML = `
      <div class="stat-chip"><div class="stat-num">${data.files_fetched||0}</div><div class="stat-label">files fetched</div></div>
      <div class="stat-chip"><div class="stat-num purple">${data.chunks_created||0}</div><div class="stat-label">chunks embedded</div></div>
      <div class="stat-chip"><div class="stat-num orange">${(data.priority_files||[]).length}</div><div class="stat-label">priority files</div></div>
      <div class="stat-chip"><div class="stat-num green">✓</div><div class="stat-label">RAG ready</div></div>
    `;

    document.getElementById('fileCount').textContent = (data.priority_files||[]).length;
    document.getElementById('fileList').innerHTML = (data.priority_files||[]).map(f => {
      const ext = f.split('.').pop().toLowerCase();
      const color = FILE_COLORS[ext] || '#4a6278';
      const fileName = f.split('/').pop();
      const dir = f.includes('/') ? f.substring(0, f.lastIndexOf('/')+1) : '';
      return `<div class="file-item" data-file="${fileName.replace(/"/g,'&quot;')}">
        <span class="file-ext" style="color:${color};border-color:${color}44;background:${color}18">${ext}</span>
        <span class="file-name" title="${f}">${dir}<strong>${fileName}</strong></span>
      </div>`;
    }).join('') || '<div style="padding:12px;color:var(--muted);font-size:11px">No priority files found</div>';

    document.getElementById('fileList').querySelectorAll('.file-item').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('chatInput').value = `Explain what ${el.dataset.file} does and its role in the project.`;
        sendChat();
      });
    });

    const summary = data.summary || 'No summary available.';
    document.getElementById('summaryContent').innerHTML = summary
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
      .replace(/`([^`]+)`/g,'<code>$1</code>')
      .replace(/^#{1,3} (.+)$/gm,'<h3>$1</h3>')
      .replace(/\n\n/g,'</p><p>').replace(/^/,'<p>').replace(/$/,'</p>');

    document.getElementById('chatInput').disabled = false;
    document.getElementById('sendBtn').disabled = false;
    document.getElementById('chatMessages').innerHTML = `
      <div class="chat-empty" id="chatEmpty">
        <div class="chat-empty-icon">◈</div>
        <h3>Repo analysed</h3>
        <p>Ask anything about the codebase, architecture, or specific files.</p>
      </div>`;
    document.getElementById('msgCounter').classList.remove('visible');
    showResults(true);
  }

  async function sendChat() {
    const input = document.getElementById('chatInput');
    const question = input.value.trim();
    if (!question || !sessionId) return;
    if (question.length > 2000) { showToast('Question too long (max 2000 chars)', 'error'); return; }

    input.value = ''; updateCharCount();
    document.getElementById('sendBtn').disabled = true;
    document.getElementById('chatEmpty')?.remove();

    appendMessage('user', question);
    chatHistory.push({ role: 'user', content: question });
    if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);

    const typingId = appendTyping();

    try {
      let res;
      try {
        res = await fetch(`${API}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, question, history: chatHistory.slice(0,-1) })
        });
      } catch (networkErr) {
        throw new Error('Network error — cannot reach backend.');
      }

      removeTyping(typingId);
      const { ok, data, errorMsg } = await safeJson(res);

      if (!ok) {
        const msg = errorMsg || '';
        if (msg.includes('429') || msg.toLowerCase().includes('rate_limit') || msg.toLowerCase().includes('rate limit')) {
          appendMessage('ai', `🔒 **Daily AI limit reached.**\n\nThis app uses a free AI API with a daily token limit. Please wait a few hours for the limit to reset, or ask the developer to upgrade the API plan.`);
        } else {
          appendMessage('ai', `⚠ Server error: ${msg}`);
        }
        return;
      }

      appendMessage('ai', data.answer || 'No response received.');
      chatHistory.push({ role: 'assistant', content: data.answer });
      messageCount = data.message_count || messageCount + 1;
      updateMsgCounter();

    } catch (err) {
      removeTyping(typingId);
      appendMessage('ai', `⚠ ${err.message || 'Something went wrong. Please try again.'}`);
    } finally {
      document.getElementById('sendBtn').disabled = false;
      input.focus();
    }
  }

  function updateMsgCounter() {
    const el = document.getElementById('msgCounter');
    el.textContent = `${messageCount} message${messageCount!==1?'s':''}`;
    el.classList.add('visible');
  }
  function updateCharCount() {
    const val = document.getElementById('chatInput').value;
    const el = document.getElementById('charCount');
    if (val.length > 1800) {
      el.textContent = `${2000-val.length} left`;
      el.style.color = val.length > 1950 ? 'var(--danger)' : 'var(--muted)';
    } else { el.textContent = ''; }
  }

  function renderBubble(text) {
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/```(\w+)?\n?([\s\S]*?)```/g,(_,l,c)=>`<pre><code>${c.trim()}</code></pre>`)
      .replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/^[-*] (.+)$/gm,'<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)+/g,s=>`<ul>${s}</ul>`)
      .replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
  }
  function appendMessage(role, text) {
    const msgs = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `<div class="avatar ${role}">${role==='ai'?'AI':'U'}</div><div class="bubble">${renderBubble(text)}</div>`;
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
  }
  function appendTyping() {
    const msgs = document.getElementById('chatMessages');
    const id = 'typing_'+Date.now();
    const div = document.createElement('div');
    div.className = 'message ai'; div.id = id;
    div.innerHTML = `<div class="avatar ai">AI</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
    return id;
  }
  function removeTyping(id) { document.getElementById(id)?.remove(); }

  function clearChat() {
    chatHistory = []; messageCount = 0;
    document.getElementById('msgCounter').classList.remove('visible');
    document.getElementById('chatMessages').innerHTML = `<div class="chat-empty" id="chatEmpty"><div class="chat-empty-icon">◈</div><h3>Chat cleared</h3><p>Start a fresh conversation about this repo.</p></div>`;
    showToast('Chat cleared', 'success');
  }
  function copySession() {
    if (!sessionId) return;
    navigator.clipboard.writeText(sessionId).then(() => showToast('Session ID copied', 'success'));
  }
  function resetAnalysis() {
    sessionId = null; chatHistory = []; messageCount = 0;
    showResults(false);
    document.getElementById('repoUrl').value = '';
    document.getElementById('repoUrl').focus();
    document.getElementById('chatInput').disabled = true;
    document.getElementById('sendBtn').disabled = true;
    hideError();
  }

  function showResults(show) { document.getElementById('results').className = show ? 'results active' : 'results'; }
  function showError(msg) { document.getElementById('errorText').textContent = msg; document.getElementById('errorMsg').className = 'error-msg active'; }
  function hideError() { document.getElementById('errorMsg').className = 'error-msg'; }
  function showToast(msg, type='success') {
    const el = document.getElementById('toast');
    el.textContent = (type==='success'?'✓  ':'⚠  ') + msg;
    el.className = `toast active ${type}`;
    setTimeout(()=>{ el.className='toast'; }, 3000);
  }

  window.addEventListener('pagehide', e => { if (isAnalysing) { e.preventDefault(); e.returnValue=''; } });

  checkApiHealth();