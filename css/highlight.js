document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const highlightQuery = params.get('h');

    if (highlightQuery) {
        const query = decodeURIComponent(highlightQuery);
        highlightAndScroll(query);
    }
});

function highlightAndScroll(query) {
    if (!query || query.length < 1) return;

    // キーワードを分割（スペース区切り）
    const keywords = query.split(/\s+/).filter(k => k.length > 0);
    if (keywords.length === 0) return;

    // 全キーワードをカバーする正規表現を作成
    const escapedKws = keywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escapedKws.join('|')})`, 'gi');

    // テキストノードを走査してハイライトを適用
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    let node;
    while (node = walker.nextNode()) {
        if (node.parentElement.tagName !== 'SCRIPT' && 
            node.parentElement.tagName !== 'STYLE' && 
            node.parentElement.tagName !== 'TEXTAREA' &&
            regex.test(node.textContent)) {
            nodes.push(node);
        }
    }

    let firstMatch = null;

    nodes.forEach(textNode => {
        const parent = textNode.parentElement;
        const text = textNode.textContent;
        
        const fragment = document.createDocumentFragment();
        let lastIdx = 0;
        
        text.replace(regex, (match, p1, offset) => {
            fragment.appendChild(document.createTextNode(text.substring(lastIdx, offset)));
            
            const mark = document.createElement('mark');
            mark.textContent = match;
            mark.className = 'search-highlight';
            mark.style.backgroundColor = '#fff9c4';
            mark.style.color = '#d32f2f';
            mark.style.fontWeight = 'bold';
            fragment.appendChild(mark);
            
            if (!firstMatch) firstMatch = mark;
            lastIdx = offset + match.length;
        });
        
        fragment.appendChild(document.createTextNode(text.substring(lastIdx)));
        if (parent && parent.contains(textNode)) {
            parent.replaceChild(fragment, textNode);
        }
    });

    // 最初のマッチ箇所にジャンプ
    if (firstMatch) {
        setTimeout(() => {
            firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // 脈動アニメーションを付与
            firstMatch.classList.add('search-highlight-pulsate');
            // 5秒後に削除
            setTimeout(() => {
                firstMatch.classList.remove('search-highlight-pulsate');
            }, 5000);
        }, 800);
    }
}
