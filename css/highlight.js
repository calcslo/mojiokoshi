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

    // テキストノードを走査してハイライトを適用
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    let node;
    while (node = walker.nextNode()) {
        if (node.parentElement.tagName !== 'SCRIPT' && node.parentElement.tagName !== 'STYLE' && node.textContent.includes(query)) {
            nodes.push(node);
        }
    }

    let firstMatch = null;

    nodes.forEach(textNode => {
        const parent = textNode.parentElement;
        const text = textNode.textContent;
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        
        const fragment = document.createDocumentFragment();
        let lastIdx = 0;
        
        text.replace(regex, (match, p1, offset) => {
            // マッチ前のテキスト
            fragment.appendChild(document.createTextNode(text.substring(lastIdx, offset)));
            
            // ハイライト用要素
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
        parent.replaceChild(fragment, textNode);
    });

    // 最初のマッチ箇所にジャンプ
    if (firstMatch) {
        setTimeout(() => {
            firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 500);
    }
}
