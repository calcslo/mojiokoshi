// ============================================================
// 共通検索エンジン v3 - 完全修正版
// ============================================================

const SEMESTER_MAP = {
    'S1': ['呼吸器', '循環', '救急', '泌尿器', '疼痛', '耳鼻科', '腎', '麻酔'],
    'S2': ['内分泌', '小児', '消化器', '皮膚', '神経内科', '神経外科', '精神']
};
const PAGE_SIZE = 15;

// グローバル状態
let __engine = null;

class SearchEngine {
    constructor(config) {
        this.config = config;
        this.index = null;
        this.embedder = null;
        this.results = [];
        this.offset = 0;
        this.ready = false;
    }

    get inputEl()   { return document.getElementById(this.config.inputId); }
    get resultsEl() { return document.getElementById(this.config.resultsId); }
    get statusEl()  { return document.getElementById(this.config.statusId); }
    get filterEl()  { return this.config.filterContainerId ? document.getElementById(this.config.filterContainerId) : null; }
    get progressEl(){ return this.config.progressId ? document.getElementById(this.config.progressId) : null; }
    get progressContainerEl() { return this.config.progressContainerId ? document.getElementById(this.config.progressContainerId) : null; }

    setStatus(msg) {
        if (this.statusEl) this.statusEl.textContent = msg;
    }

    async init() {
        // 遅延読み込みのため、最初はイベントリスナーの設定のみ行う
        if (this.inputEl) {
            this.inputEl.disabled = false; // 入力は可能にする
            this.inputEl.addEventListener('focus', () => this.ensureReady(), { once: true });
            this.inputEl.addEventListener('input', (e) => {
                const q = e.target.value.trim();
                if (q.length >= 2) this.ensureReady();
            }, { once: true });
        }
        
        // 状態復元
        this._restoreState();
        
        // 入力イベント（メイン）
        let debounce;
        this.inputEl?.addEventListener('input', (e) => {
            clearTimeout(debounce);
            const q = e.target.value.trim();
            this._saveState(q);
            if (q.length < 2) {
                if (this.resultsEl) {
                    this.resultsEl.innerHTML = '';
                    this.resultsEl.style.display = 'none';
                }
                return;
            }
            if (this.ready) {
                debounce = setTimeout(() => this.search(q), 400);
            }
        });

        // 検索ボタン（もしあれば）
        const btn = document.getElementById(this.config.buttonId || 'sideSearchBtn');
        if (btn) {
            btn.addEventListener('click', () => {
                const q = this.inputEl?.value.trim();
                if (q) {
                    if (this.ready) this.search(q);
                    else this.ensureReady().then(() => this.search(q));
                }
            });
        }
    }

    async ensureReady() {
        if (this.ready || this.loading) return;
        this.loading = true;
        
        const { rootPath } = this.config;
        try {
            this.setStatus('モデルロード中...');
            if (this.progressContainerEl) this.progressContainerEl.style.display = 'block';

            // ✅ 動的インポート
            const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');
            this.embedder = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
                quantized: true
            });

            this.setStatus('インデックス読込中...');
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const indexFile = isMobile ? 'search_index_light.json' : 'search_index.json';

            const resp = await fetch(`${rootPath}${indexFile}`);
            if (!resp.ok) throw new Error(`${indexFile} の読み込みに失敗: ${resp.status}`);

            const contentLength = resp.headers.get('content-length');
            if (contentLength && this.progressEl) {
                const total = parseInt(contentLength, 10);
                let loaded = 0;
                const reader = resp.body.getReader();
                const chunks = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.length;
                    this.progressEl.style.width = `${(loaded / total) * 100}%`;
                }
                const all = new Uint8Array(loaded);
                let pos = 0;
                for (const c of chunks) { all.set(c, pos); pos += c.length; }
                this.index = JSON.parse(new TextDecoder().decode(all));
            } else {
                this.index = await resp.json();
            }

            if (this.progressContainerEl) this.progressContainerEl.style.display = 'none';

            // 共有用グローバル
            window.__sharedSearchIndex = this.index;
            window.__sharedEmbedder = this.embedder;

            // フィルター構築
            if (this.filterEl) this._buildFilters();

            this.ready = true;
            this.loading = false;
            this.setStatus(`検索できます（${isMobile ? '軽量' : 'フル'}モード）`);

            // すでに入力があれば検索実行
            const q = this.inputEl?.value.trim();
            if (q && q.length >= 2) this.search(q);

        } catch (err) {
            console.error('[SearchEngine] ensureReady error:', err);
            this.setStatus(`エラー: ${err.message}`);
            this.loading = false;
        }
    }

    _buildFilters() {
        // インデックスから診療科を抽出 (URLのフォルダ名を利用)
        const depts = [...new Set(
            (this.index || []).map(item => {
                const u = item.url || '';
                const parts = u.split('/');
                return parts.length >= 2 ? parts[parts.length - 2] : null;
            }).filter(Boolean)
        )].sort();

        let html = '<div style="font-size:11px;color:#555;margin:8px 0 5px;font-weight:bold;">絞り込み（未選択=全件）</div>';

        // セメスター
        html += '<div style="display:flex;gap:12px;margin-bottom:8px;">';
        ['S1', 'S2'].forEach(s => {
            html += `<label style="font-size:12px;cursor:pointer;user-select:none;display:flex;align-items:center;gap:3px;">
                       <input type="checkbox" class="filter-sem" value="${s}"> <strong>${s}</strong>
                     </label>`;
        });
        html += '</div>';

        // 診療科
        if (depts.length > 0) {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;max-height:120px;overflow-y:auto;padding-right:4px;">';
            depts.forEach(d => {
                html += `<label style="font-size:11px;cursor:pointer;user-select:none;background:#f5f5f5;border:1px solid #ddd;padding:2px 8px;border-radius:12px;display:flex;align-items:center;gap:3px;transition: background 0.2s;">
                           <input type="checkbox" class="filter-dept" value="${d}"> ${d}
                         </label>`;
            });
            html += '</div>';
        }

        this.filterEl.innerHTML = html;

        // フィルター変更時に再検索
        this.filterEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                const q = this.inputEl?.value.trim() || '';
                this._saveState(q);
                if (q.length >= 2) this.search(q);
            });
        });
    }

    async search(query) {
        if (!this.index) return;
        this.setStatus('検索中...');

        try {
            const keywords = query.match(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]{2,}|[a-zA-Z]{3,}|[0-9]{2,}/g) || [query];

            // セマンティックベクトル（embedderがあれば）
            let queryVector = null;
            if (this.embedder) {
                const out = await this.embedder(`query: ${query}`, { pooling: 'mean', normalize: true });
                queryVector = Array.from(out.data);
            }

            // フィルター取得
            const activeSems  = [...document.querySelectorAll('.filter-sem:checked')].map(c => c.value);
            const activeDepts = [...document.querySelectorAll('.filter-dept:checked')].map(c => c.value);

            const scored = this.index
                .filter(item => {
                    // 何も選択されていない場合は全件対象
                    if (activeSems.length === 0 && activeDepts.length === 0) return true;
                    
                    const t = item.title || '';
                    let dept = null;
                    if (t.startsWith('講義ノート：')) {
                        const parts = t.replace('講義ノート：', '').split(/\s+/);
                        dept = parts.length >= 2 ? parts[1].trim() : null;
                    }
                    if (!dept) return false;

                    // 診療科直接指定
                    if (activeDepts.length > 0 && activeDepts.includes(dept)) return true;

                    // セメスター指定
                    if (activeSems.includes('S1') && SEMESTER_MAP['S1'].includes(dept)) return true;
                    if (activeSems.includes('S2') && SEMESTER_MAP['S2'].includes(dept)) return true;

                    return false;
                })
                .map(item => {
                    const text  = (item.content || '').toLowerCase();
                    const title = (item.title   || '').toLowerCase();
                    let kwScore = 0;
                    for (const kw of keywords) {
                        const kl = kw.toLowerCase();
                        if (text.includes(kl))  kwScore += 1;
                        if (title.includes(kl)) kwScore += 1.5;
                    }
                    kwScore = Math.min(1, kwScore / (keywords.length * 2.5));

                    if (queryVector && item.embedding) {
                        let cos = 0;
                        for (let i = 0; i < queryVector.length; i++) cos += queryVector[i] * item.embedding[i];
                        const sem = (cos + 1) / 2;
                        return { ...item, score: Math.min(1, sem * 0.6 + kwScore * 0.4) };
                    }
                    return { ...item, score: kwScore };
                });

            this.results = scored
                .filter(r => r.score > (queryVector ? 0.35 : 0.01))
                .sort((a, b) => b.score - a.score);

            this.offset = 0;
            this._renderPage(query, false);
            this.setStatus(`${this.results.length}件発見`);
            this._saveState(query, this.results);

        } catch (err) {
            console.error('[SearchEngine] search error:', err);
            this.setStatus('検索エラー: ' + err.message);
        }
    }

    _renderPage(query, append) {
        const el = this.resultsEl;
        if (!el) return;
        const { rootPath } = this.config;
        const slice = this.results.slice(this.offset, this.offset + PAGE_SIZE);
        this.offset += PAGE_SIZE;

        if (!append) el.innerHTML = '';
        el.querySelector('.show-more-btn')?.remove();

        if (slice.length === 0 && !append) {
            el.innerHTML = '<div style="padding:16px;color:#888;text-align:center;">結果がありません</div>';
        }

        const frag = document.createDocumentFragment();
        slice.forEach(item => {
            const a = document.createElement('a');
            a.href = `${rootPath}${item.url}?h=${encodeURIComponent(query)}`;
            a.style.cssText = 'display:block;padding:10px 12px;text-decoration:none;border-bottom:1px solid #eee;';
            a.innerHTML = `
              <span style="font-weight:bold;font-size:12px;color:#222;display:block;margin-bottom:2px;">${this._hl(item.title||'', query)}</span>
              <div style="font-size:11px;color:#666;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${this._hl(item.content||'', query)}</div>
              <div style="font-size:10px;color:#aaa;margin-top:3px;">一致度: ${Math.round(item.score*100)}%</div>
            `;
            frag.appendChild(a);
        });
        el.appendChild(frag);
        el.style.display = 'block';

        if (this.offset < this.results.length) {
            const btn = document.createElement('button');
            btn.className = 'show-more-btn';
            btn.textContent = `さらに表示（残り ${this.results.length - this.offset} 件）`;
            btn.style.cssText = 'display:block;width:100%;padding:10px;margin-top:4px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;font-size:12px;cursor:pointer;';
            btn.onclick = () => { btn.remove(); this._renderPage(query, true); };
            el.appendChild(btn);
        }
    }

    _hl(text, query) {
        let s = this._esc(text);
        const kws = query.match(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]{2,}|[a-zA-Z]{3,}|[0-9]{2,}|\S+/g) || [query];
        kws.forEach(kw => {
            const safe = this._esc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            s = s.replace(new RegExp(safe, 'gi'), m => `<mark style="background:#fff9c4;color:#d32f2f;font-weight:bold;">${m}</mark>`);
        });
        return s;
    }

    _esc(str) {
        return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    _saveState(query, results = null) {
        try {
            const sems  = [...document.querySelectorAll('.filter-sem:checked')].map(c => c.value);
            const depts = [...document.querySelectorAll('.filter-dept:checked')].map(c => c.value);
            const s = { query, filters: { sems, depts }, ts: Date.now() };
            if (results) s.results = results;
            sessionStorage.setItem('srch', JSON.stringify(s));
        } catch(_) {}
    }

    _restoreState() {
        try {
            const raw = sessionStorage.getItem('srch');
            if (!raw) return;
            const s = JSON.parse(raw);
            if (Date.now() - s.ts > 30 * 60 * 1000) return;
            if (s.query && this.inputEl) this.inputEl.value = s.query;
            if (s.filters) {
                s.filters.sems.forEach(v => {
                    const cb = document.querySelector(`.filter-sem[value="${v}"]`);
                    if (cb) cb.checked = true;
                });
                s.filters.depts.forEach(v => {
                    const cb = document.querySelector(`.filter-dept[value="${v}"]`);
                    if (cb) cb.checked = true;
                });
            }
            if (s.results) {
                this.results = s.results;
                this.offset = 0;
                this._renderPage(s.query, false);
                this.setStatus(`${this.results.length}件（復元）`);
            }
        } catch(_) {}
    }
}

// ============================================================
// 公開API
// ============================================================
async function initSearchComponent(config) {
    __engine = new SearchEngine(config);
    await __engine.init();
}
