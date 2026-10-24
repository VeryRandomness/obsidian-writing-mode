// The self-updater in main.js: it installs the latest GitHub release, and nothing else.
// The updater code is cut out of main.js and run against a stand-in for GitHub.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const body = src.slice(src.indexOf('// ---- Auto-update from GitHub ----'), src.indexOf('class WritingModePlugin'));
assert(body.includes('async function checkForUpdate'), 'could not find the updater in main.js');

const REPO = 'VeryRandomness/obsidian-writing-mode', DIR = '.obsidian/plugins/vr-writing-mode';
let web = {}; const notices = [];
class Notice { constructor(m) { notices.push(m); } }
const requestUrl = async ({ url }) => {
	if (web.offline) throw new Error('offline');
	let m = url.match(/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\/latest/);
	if (m) { if (!web.release) throw new Error('Request failed, status 404'); return { json: web.release }; }
	m = url.match(/github\.com\/([^/]+\/[^/]+)\/releases\/download\/[^/]+\/(.+)$/);
	if (m && web[m[2]] !== undefined) return { text: web[m[2]] };
	throw new Error('404 ' + url);
};
const { checkForUpdate } = new Function('requestUrl', 'Notice', body + '; return { checkForUpdate };')(requestUrl, Notice);
const release = (tag, files) => ({ release: { tag_name: tag, assets: Object.keys(files).map((n) => ({ name: n, browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${n}` })) }, ...files });
const man = (o) => JSON.stringify(Object.assign({ id: 'vr-writing-mode', version: '1.0.0' }, o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(w, manual = true) {
	web = w; notices.length = 0; const files = { [DIR + '/manifest.json']: man({}), [DIR + '/main.js']: 'OLD' }; const writes = []; const reload = [];
	const plugin = { manifest: { id: 'vr-writing-mode', name: 'Writing mode', version: '1.0.0', dir: DIR },
		app: { vault: { adapter: { read: async (f) => files[f], write: async (f, t) => { files[f] = t; writes.push(path.basename(f)); } } },
			plugins: { disablePlugin: async (x) => reload.push('d ' + x), enablePlugin: async (x) => reload.push('e ' + x) } } };
	await checkForUpdate(plugin, manual); await sleep(650);
	return { files, writes, reload, n: [...notices] };
}

(async () => {
	let r = await run(release('1.0.1', { 'manifest.json': man({ version: '1.0.1' }), 'main.js': 'NEW', 'styles.css': 'CSS' }));
	assert.deepStrictEqual(r.writes, ['main.js', 'styles.css', 'manifest.json'], 'installs everything, manifest last');
	assert.strictEqual(r.files[DIR + '/main.js'], 'NEW'); assert.deepStrictEqual(r.reload, ['d vr-writing-mode', 'e vr-writing-mode']);
	r = await run(release('v1.0.1', { 'manifest.json': man({ version: '1.0.1' }), 'main.js': 'NEW' }));
	assert.deepStrictEqual(r.writes, ['main.js', 'manifest.json'], 'styles.css is optional; v-prefixed tags are fine');
	for (const [label, w, expect] of [
		['same version', release('1.0.0', { 'manifest.json': man({}), 'main.js': 'X' }), /up to date/],
		['older release', release('0.9.0', { 'manifest.json': man({ version: '0.9.0' }), 'main.js': 'X' }), /up to date/],
		['no release (main branch ignored)', { 'manifest.json': man({ version: '9.9.9' }), 'main.js': 'MAIN' }, /no release|404/],
		['tag and manifest disagree', release('2.0.0', { 'manifest.json': man({ version: '2.0.1' }), 'main.js': 'X' }), /contains version/],
		["another plugin's id", release('9.0.0', { 'manifest.json': man({ id: 'writing-mode', version: '9.0.0' }), 'main.js': 'EVIL' }), /different plugin id/],
		['main.js missing', release('1.0.1', { 'manifest.json': man({ version: '1.0.1' }) }), /has no main\.js/],
		['main.js empty', release('1.0.1', { 'manifest.json': man({ version: '1.0.1' }), 'main.js': ' ' }), /empty/],
		['a listed file fails to download', (() => { const w = release('1.0.1', { 'manifest.json': man({ version: '1.0.1' }), 'main.js': 'NEW', 'styles.css': 'CSS' }); delete w['styles.css']; return w; })(), /404/],
		['offline', { offline: true }, /Update check failed/],
	]) {
		r = await run(w);
		assert.strictEqual(r.writes.length, 0, `${label}: nothing written, got ${JSON.stringify(r.writes)}`);
		assert.strictEqual(r.files[DIR + '/main.js'], 'OLD', `${label}: installed files untouched`);
		assert(r.n.some((x) => expect.test(x)), `${label}: notice says why: ${JSON.stringify(r.n)}`);
	}
	r = await run({ offline: true }, false);
	assert.strictEqual(r.n.length, 0, 'a failing startup check is silent');
	console.log('UPDATER TESTS PASS');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
