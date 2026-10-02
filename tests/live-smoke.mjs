// 真实网络烟测：需要先 npm start，会实际向所列第三方上传公开示例图片。
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const sample = 'https://images.plurk.com/32B15UXxymfSMwKGTObY5e.jpg';
const imageResponse = await fetch(sample);
assert.ok(imageResponse.ok, '测试图片下载成功');
const image = await imageResponse.blob();
const outcomes = [];
for (const engine of ['trace', 'animetrace', 'saucenao', 'yandex', 'soutubot', 'google']) {
  const modes = engine === 'google' ? ['file'] : ['file', 'url'];
  for (const mode of modes) {
    const form = new FormData();
    form.set('image', image, 'public-sample.jpg');
    const response = await fetch(base + '/api/search/' + engine, {
      method: 'POST',
      body: mode === 'file' ? form : JSON.stringify({ url: sample }),
      headers: mode === 'url' ? { 'Content-Type': 'application/json' } : {},
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json();
    const count = data.results?.length || 0,
      pictures = (data.results || []).filter((r) => r.thumbnail).length;
    const ok = response.ok && data.status !== 'attention' && count > 0 && pictures > 0;
    outcomes.push({
      engine,
      mode,
      http: response.status,
      state: ok ? 'PASS' : data.status || 'FAIL',
      results: count,
      pictures,
      note: ok ? '' : data.error || data.note,
    });
    console.log(JSON.stringify(outcomes.at(-1)));
  }
}
const failed = outcomes.filter((r) => r.engine !== 'google' && r.state !== 'PASS');
if (failed.length) process.exitCode = 1;
console.log(
  '核心五引擎:',
  failed.length ? '存在失败，请检查以上记录' : '文件与受支持的 URL 检索均通过',
);
console.log('Google 是单独的实验性验收项，attention/FAIL 均不代表识别成功。');
