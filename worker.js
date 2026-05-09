// Cloudflare Workers バックエンド (worker.js)
// =====================================================================
// デプロイ手順:
//   1. https://workers.cloudflare.com/ で無料アカウントを作成
//   2. 新しいWorkerを作成し、このコードを貼り付けてデプロイ
//   3. Settings > Variables > Secret Variables で以下を登録:
//      GEMINI_API_KEY = あなたのGemini APIキー
//      ALLOWED_ORIGIN = https://あなたのGitHubユーザー名.github.io
// =====================================================================

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    // --- CORS プリフライト ---
    if (request.method === 'OPTIONS') {
      return corsResponse(null, origin, env, 204);
    }

    // --- オリジン制限（あなたのGitHub PagesのURLのみ許可）---
    if (!isAllowed(origin, env.ALLOWED_ORIGIN)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // --- POST /chat のみ受け付ける ---
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/chat') {
      return corsResponse(JSON.stringify({ error: 'Not found' }), origin, env, 404);
    }

    // --- リクエストボディのパース ---
    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(JSON.stringify({ error: 'Invalid JSON' }), origin, env, 400);
    }

    const { question, context } = body;
    if (!question || typeof question !== 'string' || question.length > 2000) {
      return corsResponse(JSON.stringify({ error: 'Invalid question' }), origin, env, 400);
    }

    // --- Gemini API 呼び出し ---
    const systemPrompt = `あなたは大学の講義ノートを参照して質問に答えるアシスタントです。
以下の【参考資料】は、検索によって絞り込まれた講義内容の一部です。
参考資料の内容を優先して、わかりやすく日本語で答えてください。
参考資料に関係ない質問には「講義ノートには該当する情報がありません」と答えてください。`;

    const userContent = `【質問】\n${question}\n\n【参考資料】\n${context || '（関連する講義が見つかりませんでした）'}`;

    const geminiPayload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
    };

    const apiKeys = env.GEMINI_API_KEY.split(',');
    const apiKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
    const model = 'gemini-3.1-flash-lite-preview';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    let geminiResp;
    try {
      geminiResp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload)
      });
    } catch (e) {
      return corsResponse(JSON.stringify({ error: 'Gemini API接続失敗' }), origin, env, 502);
    }

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      return corsResponse(JSON.stringify({ error: `Gemini APIエラー: ${geminiResp.status}` }), origin, env, 502);
    }

    const geminiData = await geminiResp.json();
    const answer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '回答を生成できませんでした。';

    return corsResponse(JSON.stringify({ answer }), origin, env, 200);
  }
};

function isAllowed(origin, allowed) {
  if (!allowed) return false;
  // 複数オリジンをカンマ区切りで設定できる
  return allowed.split(',').map(s => s.trim()).some(a => origin === a || origin.startsWith(a));
}

function corsResponse(body, origin, env, status) {
  const allowedOrigin = (env && env.ALLOWED_ORIGIN) ? env.ALLOWED_ORIGIN.split(',')[0].trim() : '*';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (status === 204) return new Response(null, { status, headers });
  return new Response(body, { status, headers });
}
