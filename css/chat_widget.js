// ============================================================
// チャットウィジェット (chat_widget.js)
// 使い方：HTMLの</body>の直前に以下を追記
// <script src="./css/chat_widget.js"></script>
//   または深いパス用
// <script src="../../css/chat_widget.js"></script>
// ============================================================

(function () {
  // === 設定 ===
  const WORKER_URL = 'https://univ-chat-proxy.mikihirom614.workers.dev/chat'; // ← Cloudflare Worker のURLに変更
  const ROOT_PATH = (() => {
    // パスの深さから自動的に検索インデックスのルートを解決
    const depth = location.pathname.split('/').filter(Boolean).length;
    if (depth <= 1) return './';
    if (depth <= 3) return '../../';
    return '../'.repeat(depth - 1);
  })();

  // === スタイルの注入 ===
  const style = document.createElement('style');
  style.textContent = `
    #chat-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #1976d2, #42a5f5);
      color: white; font-size: 24px; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(25,118,210,0.4);
      transition: transform 0.2s, box-shadow 0.2s;
      display: flex; align-items: center; justify-content: center;
    }
    #chat-fab:hover { transform: scale(1.1); box-shadow: 0 8px 24px rgba(25,118,210,0.5); }
    #chat-window {
      position: fixed; bottom: 90px; right: 24px; z-index: 9998;
      width: 360px; max-width: calc(100vw - 48px);
      height: 500px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      display: none; flex-direction: column; overflow: hidden;
      border: 1px solid #e3f2fd; font-family: sans-serif;
      animation: chatAppear 0.25s ease;
    }
    #chat-window.open { display: flex; }
    #chat-window.expanded {
      width: 90vw; max-width: 1080px;
      height: 90vh; max-height: 1500px;
    }
    @keyframes chatAppear { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
    #chat-header {
      background: linear-gradient(135deg, #1565c0, #1976d2);
      color: white; padding: 14px 16px;
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
    }
    #chat-header span { font-size: 14px; font-weight: bold; }
    .chat-header-actions { display: flex; gap: 12px; align-items: center; }
    .chat-btn { background: none; border: none; color: white; font-size: 18px; cursor: pointer; padding: 0; line-height: 1; transition: transform 0.2s; }
    .chat-btn:hover { transform: scale(1.2); }
    #chat-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .chat-msg { max-width: 80%; line-height: 1.6; font-size: 13px; }
    .chat-msg.user {
      align-self: flex-end; background: #e3f2fd;
      color: #1a237e; padding: 10px 14px; border-radius: 18px 18px 4px 18px;
    }
    .chat-msg.bot {
      align-self: flex-start; background: #f5f5f5;
      color: #333; padding: 10px 14px; border-radius: 18px 18px 18px 4px;
    }
    .chat-msg.bot.thinking { color: #aaa; font-style: italic; }
    #chat-input-area {
      display: flex; gap: 8px; padding: 12px; border-top: 1px solid #eee;
      flex-shrink: 0; background: #fafafa;
    }
    #chat-input {
      flex: 1; padding: 9px 14px; border: 1px solid #ccc; border-radius: 20px;
      font-size: 13px; outline: none; font-family: inherit;
    }
    #chat-input:focus { border-color: #1976d2; }
    #chat-send-btn {
      background: #1976d2; color: white; border: none; border-radius: 50%;
      width: 36px; height: 36px; cursor: pointer; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background 0.2s;
    }
    #chat-send-btn:hover { background: #1565c0; }
    #chat-send-btn:disabled { background: #ccc; cursor: default; }
    #chat-context-info {
      font-size: 10px; color: #888; padding: 0 16px 8px;
      border-bottom: 1px solid #eee; flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);

  // === HTMLの注入 ===
  const fab = document.createElement('button');
  fab.id = 'chat-fab';
  fab.title = '講義AIアシスタント';
  fab.textContent = '💬';

  const win = document.createElement('div');
  win.id = 'chat-window';
  win.innerHTML = `
    <div id="chat-header">
      <span>📚 講義AIアシスタント</span>
      <div class="chat-header-actions">
        <button id="chat-expand-btn" class="chat-btn" title="拡大/縮小">⛶</button>
        <button id="chat-close-btn" class="chat-btn" title="閉じる">✕</button>
      </div>
    </div>
    <div id="chat-filter-area" style="padding: 8px 16px; border-bottom: 1px solid #eee; display: flex; gap: 8px; background: #fafafa;">
      <select id="chat-filter-sem" style="font-size: 11px; padding: 4px; border-radius: 4px; border: 1px solid #ccc; outline: none;">
        <option value="">全セメスター</option>
        <option value="S1">S1</option>
        <option value="S2">S2</option>
      </select>
      <select id="chat-filter-dept" style="font-size: 11px; padding: 4px; border-radius: 4px; border: 1px solid #ccc; outline: none; flex: 1;">
        <option value="">全診療科</option>
      </select>
    </div>
    <div id="chat-context-info">関連する講義を自動検索してGeminiが回答します</div>
    <div id="chat-messages">
      <div class="chat-msg bot">こんにちは！講義の内容について何でも質問してください。<br>例：「心筋梗塞の治療法は？」「喘息の吸入薬について教えて」</div>
    </div>
    <div id="chat-input-area">
      <input type="text" id="chat-input" placeholder="講義の内容を質問..." maxlength="500">
      <button id="chat-send-btn">➤</button>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(win);

  // === イベント ===
  fab.addEventListener('click', async () => {
    win.classList.toggle('open');
    if (win.classList.contains('open')) {
      await ensureSearchEngineReady();
      updateDeptFilter();
    }
  });
  document.getElementById('chat-close-btn').addEventListener('click', () => win.classList.remove('open'));
  document.getElementById('chat-expand-btn').addEventListener('click', () => win.classList.toggle('expanded'));

  async function ensureSearchEngineReady() {
    if (window._searchIndex) return true;
    if (typeof __engine !== 'undefined' && __engine) {
      await __engine.ensureReady();
      return !!window._searchIndex;
    }
    const searchInput = document.getElementById('sideSearchInput');
    if (searchInput) searchInput.dispatchEvent(new Event('focus'));
    let attempts = 0;
    await new Promise(resolve => {
        const check = setInterval(() => {
            if (window._searchIndex || ++attempts > 20) {
                clearInterval(check);
                resolve();
            }
        }, 500);
    });
    return !!window._searchIndex;
  }

  function updateDeptFilter() {
    const deptSelect = document.getElementById('chat-filter-dept');
    if (!window._searchIndex || deptSelect.options.length > 1) return;
    const depts = [...new Set(window._searchIndex.map(item => {
      const t = item.title || '';
      if (t.startsWith('講義ノート：')) {
        const parts = t.replace('講義ノート：', '').split(/\s+/);
        return parts.length >= 2 ? parts[1].trim() : null;
      }
      return null;
    }).filter(Boolean))].sort();
    depts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      deptSelect.appendChild(opt);
    });
  }

  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const messagesEl = document.getElementById('chat-messages');
  const contextInfoEl = document.getElementById('chat-context-info');

  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  sendBtn.addEventListener('click', sendMessage);

  async function sendMessage() {
    const q = chatInput.value.trim();
    if (!q) return;

    chatInput.value = '';
    sendBtn.disabled = true;

    appendMsg(q, 'user');
    const thinking = appendMsg('考え中...', 'bot thinking');

    try {
      await ensureSearchEngineReady();

      // --- RAG: search_index から関連コンテキスト取得 ---
      let context = '';
      let contextDesc = '（関連講義: なし）';

      if (window._searchIndex && window._embedder) {
        const output = await window._embedder(`query: ${q}`, { pooling: 'mean', normalize: true });
        const qv = Array.from(output.data);
        const SEMESTER_MAP = {
          'S1': ['呼吸器', '循環', '救急', '泌尿器', '疼痛', '耳鼻科', '腎', '麻酔'],
          'S2': ['内分泌', '小児', '消化器', '皮膚', '神経内科', '神経外科', '精神']
        };
        const activeSem = document.getElementById('chat-filter-sem').value;
        const activeDept = document.getElementById('chat-filter-dept').value;

        const filteredIndex = window._searchIndex.filter(item => {
          if (!activeSem && !activeDept) return true;
          const t = item.title || '';
          let dept = null;
          if (t.startsWith('講義ノート：')) {
            const parts = t.replace('講義ノート：', '').split(/\s+/);
            dept = parts.length >= 2 ? parts[1].trim() : null;
          }
          if (!dept) return false;
          if (activeDept && activeDept !== dept) return false;
          if (activeSem && !SEMESTER_MAP[activeSem].includes(dept)) return false;
          return true;
        });

        const top = filteredIndex
          .map(item => {
            let s = 0;
            for (let i = 0; i < qv.length; i++) s += qv[i] * item.embedding[i];
            return { ...item, score: (s + 1) / 2 };
          })
          .filter(r => r.score > 0.45)
          .sort((a, b) => b.score - a.score)
          .slice(0, 15);

        if (top.length > 0) {
          context = top.map(r => `【${r.title}】\n${r.content}`).join('\n\n---\n\n');
          contextDesc = `関連講義 ${top.length}件参照中`;
        }
      } else {
        contextDesc = '（検索インデックス未ロード）';
      }

      contextInfoEl.textContent = contextDesc;

      // --- Cloudflare Worker に送信 ---
      const resp = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, context })
      });

      const data = await resp.json();
      thinking.classList.remove('thinking');
      thinking.textContent = data.answer || 'エラーが発生しました。';

    } catch (err) {
      console.error(err);
      thinking.classList.remove('thinking');
      thinking.textContent = `通信エラー: ${err.message}\nWorker URLを確認してください。`;
    }

    sendBtn.disabled = false;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMsg(text, cls) {
    const el = document.createElement('div');
    el.className = `chat-msg ${cls}`;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  // search_engine.js のインデックスをチャットから参照できるよう公開
  Object.defineProperty(window, '_searchIndex', {
    get: () => window.__sharedSearchIndex,
    set: (v) => { window.__sharedSearchIndex = v; }
  });
  Object.defineProperty(window, '_embedder', {
    get: () => window.__sharedEmbedder,
    set: (v) => { window.__sharedEmbedder = v; }
  });
})();
