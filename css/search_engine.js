// ============================================================
// 共通検索エンジン (Hybrid Search: Semantic + Keyword)
// ============================================================
let _searchIndex = null;
let _embedder = null;
let _currentResults = [];
let _currentOffset = 0;
const PAGE_SIZE = 15;

async function initSearchComponent(config) {
    const { inputId, resultsId, statusId, progressId, progressContainerId, rootPath } = config;
    const searchInput = document.getElementById(inputId);
    const searchResults = document.getElementById(resultsId);
    const searchStatus = document.getElementById(statusId);
    const searchProgress = progressId ? document.getElementById(progressId) : null;
    const searchProgressContainer = progressContainerId ? document.getElementById(progressContainerId) : null;

    if (!searchInput || !searchResults) return;

    try {
        if (searchStatus) searchStatus.textContent = '検索準備中...';

        const transformersURL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
        const { pipeline } = await import(transformersURL);
        _embedder = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');

        if (searchStatus) searchStatus.textContent = 'インデックス読込中...';
        if (searchProgressContainer) searchProgressContainer.style.display = 'block';

        const response = await fetch(`${rootPath}search_index.json`);
        if (!response.ok) throw new Error('search_index.json が見つかりません');

        const contentLength = response.headers.get('content-length');
        if (!contentLength) {
            _searchIndex = await response.json();
        } else {
            const total = parseInt(contentLength, 10);
            let loaded = 0;
            const reader = response.body.getReader();
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                if (searchProgress) searchProgress.style.width = `${(loaded / total) * 100}%`;
            }
            const allChunks = new Uint8Array(loaded);
            let offset = 0;
            for (const chunk of chunks) { allChunks.set(chunk, offset); offset += chunk.length; }
            _searchIndex = JSON.parse(new TextDecoder().decode(allChunks));
        }

        if (searchStatus) searchStatus.textContent = '検索できます';
        if (searchProgressContainer) searchProgressContainer.style.display = 'none';
        searchInput.disabled = false;
        searchInput.placeholder = '全講義から意味検索...';

        // チャットウィジェットと共有（chat_widget.jsが参照する）
        window.__sharedSearchIndex = _searchIndex;
        window.__sharedEmbedder = _embedder;

        let debounceTimer;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const query = e.target.value.trim();
            if (query.length < 2) {
                searchResults.innerHTML = '';
                searchResults.classList.remove('active');
                _currentResults = [];
                _currentOffset = 0;
                return;
            }
            debounceTimer = setTimeout(() => startSearch(query, searchResults, searchStatus, rootPath), 400);
        });

    } catch (err) {
        console.error('Search init error:', err);
        if (searchStatus) searchStatus.textContent = 'ロード失敗';
    }
}

async function startSearch(query, resultsEl, statusEl, rootPath) {
    if (!_embedder || !_searchIndex) return;
    if (statusEl) statusEl.textContent = '検索中...';

    try {
        // --- セマンティックスコア計算 ---
        const output = await _embedder(`query: ${query}`, { pooling: 'mean', normalize: true });
        const queryVector = Array.from(output.data);

        // キーワードトークン分割（2文字以上の日本語単語、または3文字以上英字）
        const keywords = query.match(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]{2,}|[a-zA-Z]{3,}|[0-9]{2,}/g) || [query];

        const scored = _searchIndex.map(item => {
            // コサイン類似度（0〜1）
            let cosine = 0;
            for (let i = 0; i < queryVector.length; i++) cosine += queryVector[i] * item.embedding[i];
            // cosineSim は正規化済みなので -1〜1 → 0〜1 にスケール
            const semanticScore = (cosine + 1) / 2;

            // キーワード一致スコア（0〜1）
            const text = item.content.toLowerCase();
            const titleText = (item.title || '').toLowerCase();
            let kwHits = 0;
            for (const kw of keywords) {
                const kl = kw.toLowerCase();
                if (text.includes(kl)) kwHits += 1;
                if (titleText.includes(kl)) kwHits += 1.5; // タイトル一致は重み大
            }
            const keywordScore = Math.min(1, kwHits / (keywords.length * 2.5));

            // ハイブリッドスコア（意味60% + キーワード40%）、最大1.0（100%）
            const hybrid = Math.min(1.0, semanticScore * 0.6 + keywordScore * 0.4);

            return { ...item, score: hybrid };
        });

        // スコア降順でソート（最低しきい値0.35）
        _currentResults = scored
            .filter(r => r.score > 0.35)
            .sort((a, b) => b.score - a.score);

        _currentOffset = 0;
        renderPage(resultsEl, query, rootPath, false);

        if (statusEl) statusEl.textContent = `${_currentResults.length}件発見`;

    } catch (err) {
        console.error('Search error:', err);
        if (statusEl) statusEl.textContent = 'エラーが発生しました';
    }
}

function renderPage(el, query, rootPath, append) {
    const slice = _currentResults.slice(_currentOffset, _currentOffset + PAGE_SIZE);
    _currentOffset += PAGE_SIZE;

    if (!append) el.innerHTML = '';

    // 既存の「もっと見る」ボタンがあれば削除
    const existingBtn = el.querySelector('.show-more-btn');
    if (existingBtn) existingBtn.remove();

    const frag = document.createDocumentFragment();
    slice.forEach(item => {
        const a = document.createElement('a');
        a.href = `${rootPath}${item.url}?h=${encodeURIComponent(query)}`;
        a.className = 'search-result-item';
        a.style.cssText = 'display:block;padding:10px 12px;text-decoration:none;border-bottom:1px solid #eee;cursor:pointer;';

        // キーワードハイライト
        const titleHl = inlineHighlight(item.title || '', query);
        const contentHl = inlineHighlight(item.content || '', query);

        a.innerHTML = `
          <span style="font-weight:bold;font-size:12px;color:#1565c0;display:block;margin-bottom:3px;">${titleHl}</span>
          <div style="font-size:11px;color:#555;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${contentHl}</div>
          <div style="font-size:10px;color:#999;margin-top:4px;">一致度: ${Math.round(item.score * 100)}%</div>
        `;
        frag.appendChild(a);
    });
    el.appendChild(frag);
    el.classList.add('active');

    // 「もっと見る」ボタン
    if (_currentOffset < _currentResults.length) {
        const remaining = _currentResults.length - _currentOffset;
        const btn = document.createElement('button');
        btn.className = 'show-more-btn';
        btn.textContent = `さらに表示（残り ${remaining} 件）`;
        btn.style.cssText = 'display:block;width:100%;padding:10px;margin-top:4px;background:#e3f2fd;border:none;border-radius:4px;font-size:12px;color:#1565c0;cursor:pointer;font-family:inherit;';
        btn.addEventListener('click', () => {
            btn.remove();
            // queryとrootPathを親のinput/scriptから再取得するため属性として保持
            const q = el.dataset.query;
            const rp = el.dataset.rootPath;
            renderPage(el, q, rp, true);
        });
        el.dataset.query = query;
        el.dataset.rootPath = rootPath;
        el.appendChild(btn);
    }
}

// インラインハイライト（escapeHTMLつき）
function inlineHighlight(text, query) {
    const escaped = escapeHtml(text);
    const keywords = query.match(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]{2,}|[a-zA-Z]{3,}|[0-9]{2,}|\S+/g) || [query];
    let result = escaped;
    keywords.forEach(kw => {
        const safe = escapeHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(safe, 'gi'), m => `<mark style="background:#fff9c4;color:#d32f2f;font-weight:bold;padding:0 1px;">${m}</mark>`);
    });
    return result;
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
