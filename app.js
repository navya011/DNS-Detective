const $ = (id) => document.getElementById(id);
const domainInput = $('domainInput'), traceBtn = $('traceBtn'), recordSelect = $('recordSelect'), realLookup = $('realLookup');
const logEl = $('queryLog'), packet = $('packet'), line = $('journeyLine');
const steps = [...document.querySelectorAll('.journey-step')];
const TYPES = { A: 1, AAAA: 28, CNAME: 5, MX: 15, NS: 2, TXT: 16 };
const recordInfo = {
  A: { title: 'Address record (A)', description: 'An A record maps a domain name to an IPv4 address. A browser uses it to connect to the server hosting a website.' },
  AAAA: { title: 'IPv6 address (AAAA)', description: 'An AAAA record maps a hostname to an IPv6 address, which gives a much larger address space than IPv4.' },
  CNAME: { title: 'Canonical name (CNAME)', description: 'A CNAME record makes one hostname an alias of another. The target name is then resolved separately.' },
  MX: { title: 'Mail exchange (MX)', description: 'An MX record lists the mail servers that accept email for a domain. Lower preference numbers are tried first.' },
  NS: { title: 'Name server (NS)', description: 'An NS record names the servers responsible for a DNS zone. Delegation from parent to child zone is built from NS records.' },
  TXT: { title: 'Text record (TXT)', description: 'A TXT record stores free text used for domain verification, email policies such as SPF, and other configuration.' }
};
const typeMap = { 'A — IPv4': 'A', 'AAAA — IPv6': 'AAAA', 'CNAME — Alias': 'CNAME', 'MX — Mail': 'MX', 'NS — Name server': 'NS', 'TXT — Text': 'TXT' };
const analogy = { A: 'Like the street address of a shop.', AAAA: 'Like a newer, longer kind of street address.', CNAME: 'Like a forwarding note: "this name is the same as that one".', MX: 'Like a post office that accepts mail for the domain.', NS: 'Like a note saying who manages the records for this name.', TXT: 'Like a sticky note attached to the domain, often used to prove ownership.' };
let running = false, cache = new Map(), toastTimer, t0 = 0;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (arr, n = 4) => (arr.length > n ? [...arr.slice(0, n), `+${arr.length - n} more`] : arr);
function toast(m) { const el = $('toast'); el.textContent = m; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
function selectedType() { return typeMap[recordSelect.value] || 'A'; }
function cleanDomain(v) {
  const d = v.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/\.$/, '');
  if (!d || d.length > 253 || !d.includes('.') || d.split('.').some((p) => !p || p.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p))) return null;
  return d;
}

/* ---------- log + journey visuals ---------- */
function log(kind, text) {
  const d = document.createElement('div');
  d.className = 'log-line ' + kind;
  d.innerHTML = `<time>+${Math.round(performance.now() - t0)} ms</time><span>${esc(text)}</span>`;
  logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
}
function layout() { line.style.height = (steps[4].offsetTop - steps[0].offsetTop) + 'px'; }
function goTo(i) {
  layout();
  const y = steps[i].offsetTop - steps[0].offsetTop;
  packet.style.top = y + 'px'; $('journeyProgress').style.height = y + 'px';
}
function setStep(i, state, chips, ms) {
  const s = steps[i];
  s.classList.remove('active', 'done', 'error', 'pulse');
  if (state) s.classList.add(state);
  if (state === 'active') s.classList.add('pulse');
  if (chips) s.querySelector('.step-data').innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  if (ms != null) s.querySelector('.step-ms').textContent = ms;
  layout();
}
function resetJourney(domain, type, live) {
  steps.forEach((s, i) => { setStep(i, '', ['waiting'], ''); s.querySelector('.chip').classList.add('ghost'); });
  packet.classList.remove('show'); packet.style.top = '0px'; $('journeyProgress').style.height = '0px';
  $('tldTag').textContent = 'TLD';
  $('journeyStatus').textContent = 'Tracing'; $('journeyMessage').textContent = 'Starting lookup…';
  $('resultDomain').textContent = domain; $('resultStatus').textContent = 'Resolving…'; $('resultDot').classList.add('muted');
  $('metricType').textContent = type; ['metricTtl', 'metricTime', 'metricAnswers'].forEach((id) => $(id).textContent = '–');
  $('answerData').textContent = 'Query in progress…';
  $('modeNote').textContent = live ? 'Live mode: each step is a real DNS-over-HTTPS query.' : 'Offline demo: servers and answers are made up.';
  logEl.innerHTML = '';
}

/* ---------- DNS ---------- */
async function doh(name, type) {
  const c = new AbortController(), to = setTimeout(() => c.abort(), 7000), s = performance.now();
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: c.signal });
    if (!r.ok) throw new Error(`DNS service returned HTTP ${r.status}`);
    return { json: await r.json(), ms: Math.round(performance.now() - s) };
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'The DNS service timed out' : e.message); }
  finally { clearTimeout(to); }
}
function sim(name, type) {
  const d = (arr) => ({ Status: 0, Answer: arr.map((x) => ({ type: TYPES[type], TTL: 300, data: x })) });
  if (type === 'NS') {
    if (name === '.') return d(['a', 'b', 'c', 'd'].map((c) => c + '.root-servers.net.'));
    if (!name.includes('.')) return d(['a', 'b'].map((c) => c + '.nic.' + name + '.'));
    return d(['ns1.', 'ns2.'].map((p) => p + name + '.'));
  }
  return d([{ A: '93.184.216.34', AAAA: '2606:2800:220:1:248:1893:25c8:1946', CNAME: 'www.' + name + '.', MX: '10 mail.' + name + '.', TXT: '"v=spf1 include:' + name + ' ~all"' }[type]]);
}
async function ask(name, type, live) {
  log('q', `→ ${type} ${name === '.' ? '. (root)' : name}`);
  if (live) {
    const r = await doh(name, type);
    log('a', `← ${r.json.Status === 3 ? 'NXDOMAIN' : 'OK'} · ${(r.json.Answer || []).length} answer(s) · ${r.ms} ms`);
    return r;
  }
  await wait(350);
  const r = { json: sim(name, type), ms: Math.round(20 + Math.random() * 60) };
  log('a', `← simulated · ${r.json.Answer.length} answer(s)`);
  return r;
}
const recs = (j, t) => (j.Answer || []).filter((a) => a.type === TYPES[t]);
const hosts = (j) => recs(j, 'NS').map((a) => a.data.replace(/\.$/, '').toLowerCase());
function format(j, type) {
  const all = j.Answer || [], hit = all.filter((a) => a.type === TYPES[type]);
  const alias = type === 'CNAME' ? [] : all.filter((a) => a.type === 5);
  const ttls = hit.map((a) => a.TTL).filter(Number.isFinite);
  return { lines: [...alias.map((a) => `CNAME → ${a.data.replace(/\.$/, '')}`), ...hit.map((a) => a.data.replace(/^"|"$/g, ''))], count: hit.length, ttl: ttls.length ? Math.min(...ttls) : null };
}

/* ---------- trace ---------- */
async function hop(i, msg, snap, work) {
  setStep(i, 'active'); goTo(i); packet.classList.add('show');
  $('journeyMessage').textContent = msg; await wait(650);
  try { const r = await work(); setStep(i, 'done', r.chips, r.ms); snap[i] = { chips: r.chips, ms: r.ms }; return r; }
  catch (e) { setStep(i, 'error', [e.message], 'failed'); log('e', '✕ ' + e.message); const x = new Error(e.message); x.hop = i; throw x; }
}
async function run(domain, type, live) {
  const tld = domain.split('.').pop(), snap = [];
  $('tldTag').textContent = '.' + tld;
  await hop(0, 'Your device checks its cache and sends the question to a resolver.', snap, async () => {
    log('i', `Client asks: ${domain} IN ${type}`);
    return { chips: [`${domain} IN ${type}`, 'browser cache: miss'], ms: '' };
  });
  await hop(1, 'The resolver has no answer cached, so it starts at the root.', snap, async () => {
    return { chips: live ? ['Cloudflare 1.1.1.1', 'DNS-over-HTTPS'] : ['Demo resolver'], ms: '' };
  });
  await hop(2, 'Asking for the root servers…', snap, async () => {
    const r = await ask('.', 'NS', live), h = hosts(r.json);
    if (!h.length) throw new Error('No root servers returned');
    return { chips: short(h), ms: r.ms + ' ms' };
  });
  await hop(3, `Asking who runs .${tld}…`, snap, async () => {
    const r = await ask(tld, 'NS', live), h = hosts(r.json);
    if (!h.length) throw new Error(`No name servers found for .${tld}`);
    return { chips: short(h), ms: r.ms + ' ms' };
  });
  let final;
  await hop(4, 'Finding the domain’s own servers, then asking for the record…', snap, async () => {
    let name = domain, r, h = [], ms = 0;
    while (name.includes('.')) {
      r = await ask(name, 'NS', live); ms += r.ms; h = hosts(r.json);
      if (h.length) break;
      log('i', `${name} has no NS records of its own, trying ${name.split('.').slice(1).join('.')}`);
      name = name.split('.').slice(1).join('.');
    }
    if (!h.length) throw new Error('No authoritative servers found. The domain may not exist.');
    log('i', `Zone found: ${name}`);
    let ip = '';
    try { const g = await ask(h[0], 'A', live); ms += g.ms; const a = recs(g.json, 'A')[0]; if (a) ip = a.data; } catch (e) { /* glue lookup is optional */ }
    final = await ask(domain, type, live); ms += final.ms;
    if (final.json.Status === 3) throw new Error('NXDOMAIN: this name does not exist');
    const f = format(final.json, type);
    return { chips: [...short(h, 3), ip ? `${h[0]} = ${ip}` : null, `answer: ${f.count}`].filter(Boolean), ms: ms + ' ms' };
  });
  return { snap, final: final.json };
}
function showResult(domain, type, live, f, status, total, note) {
  const text = f.lines.length ? f.lines.join('\n') : status === 0 ? 'No record of this type was returned.' : 'No answer returned.';
  $('journeyStatus').textContent = 'Complete'; $('resultStatus').textContent = live ? (status === 0 ? 'Lookup completed' : 'DNS response received') : 'Simulated answer';
  $('resultDot').classList.remove('muted'); $('metricTime').textContent = total + ' ms'; $('metricTtl').textContent = f.ttl != null ? f.ttl + ' s' : '–';
  $('metricAnswers').textContent = String(f.count); $('answerData').textContent = text; $('modeNote').textContent = note;
  return text;
}
async function trace() {
  if (running) return;
  const domain = cleanDomain(domainInput.value);
  if (!domain) { toast('Enter a valid domain, for example example.com'); domainInput.focus(); return; }
  domainInput.value = domain; const type = selectedType(), live = realLookup.checked, key = `${domain}|${type}|${live}`;
  running = true; traceBtn.disabled = true; traceBtn.querySelector('span').textContent = 'Tracing…';
  resetJourney(domain, type, live); t0 = performance.now();
  try {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      log('i', 'Resolver cache hit: the stored answer is reused, so no servers are asked.');
      for (let i = 0; i < 5; i++) { setStep(i, 'done', hit.snap[i].chips, 'cached'); goTo(i); await wait(120); }
      $('tldTag').textContent = '.' + domain.split('.').pop();
      const total = Math.max(1, Math.round(performance.now() - t0));
      showResult(domain, type, live, hit.f, hit.status, total, 'Cache hit: this demo cache stands in for a resolver cache. It is not your operating system’s DNS cache.');
      $('metricTtl').textContent = Math.max(0, Math.ceil((hit.expires - Date.now()) / 1000)) + ' s remaining';
      $('journeyStatus').textContent = 'Cache hit'; $('journeyMessage').textContent = 'Answered from cache. The root, TLD and authoritative steps were skipped.';
      toast('Cache hit: repeat lookups skip the walk.');
    } else {
      const r = await run(domain, type, live), f = format(r.final, type);
      const total = Math.max(1, Math.round(performance.now() - t0));
      steps[1].querySelector('.step-ms').textContent = 'total ' + total + ' ms';
      const text = showResult(domain, type, live, f, r.final.Status, total, live ? `Live result. DNS status code ${r.final.Status}. The path above shows real NS data per zone, not a packet capture.` : 'Offline demo: none of this data is real.');
      $('journeyMessage').textContent = 'Trace complete.';
      cache.set(key, { key, domain, type, text, snap: r.snap, f, status: r.final.Status, expires: Date.now() + (f.ttl || 60) * 1000 });
      toast(live ? 'DNS lookup completed.' : 'Simulation completed.');
    }
  } catch (err) {
    $('journeyStatus').textContent = 'Stopped'; $('resultStatus').textContent = 'Trace stopped'; $('resultDot').classList.add('muted');
    $('journeyMessage').textContent = err.hop != null ? `Stopped at step ${err.hop + 1}: ${err.message}` : 'Something went wrong. Retry.';
    $('answerData').textContent = err.message; $('metricTime').textContent = Math.round(performance.now() - t0) + ' ms';
    $('modeNote').textContent = /timed out|HTTP|fetch|Failed/i.test(err.message) ? 'The live DNS service could not be reached. Check your connection or turn off Use live DNS.' : 'The trace could not finish.';
    toast('Trace stopped. See the log for details.');
  } finally { running = false; traceBtn.disabled = false; traceBtn.querySelector('span').textContent = 'Trace DNS'; renderCache(); }
}

/* ---------- cache, records, wiring ---------- */
function renderCache() {
  const now = Date.now(); for (const [k, e] of cache) if (e.expires <= now) cache.delete(k);
  const es = [...cache.values()];
  $('cacheBadge').textContent = es.length ? (es.length === 1 ? '1 entry' : es.length + ' entries') : 'Empty';
  if (!es.length) { $('cacheEntry').innerHTML = '<div class="cache-icon">◌</div><div><strong>No cached records yet</strong><span>Run a trace to fill the demo cache.</span></div>'; return; }
  const e = es[es.length - 1], left = Math.max(0, Math.ceil((e.expires - now) / 1000));
  $('cacheEntry').innerHTML = `<div class="cache-icon ok">✓</div><div><strong>${esc(e.domain)} · ${e.type}</strong><span>${esc(e.text.split('\n')[0].slice(0, 60))} · expires in ${left}s</span></div>`;
}
function selectRecord(type, updateDropdown = true) {
  if (updateDropdown) recordSelect.value = Object.keys(typeMap).find((k) => typeMap[k] === type) || 'A — IPv4';
  document.querySelectorAll('.record-card').forEach((c) => c.classList.toggle('selected', c.dataset.record === type));
  const info = recordInfo[type] || recordInfo.A, d = $('recordDetail');
  d.querySelector('.detail-symbol').textContent = type; d.querySelector('h3').textContent = info.title; d.querySelector('p').textContent = info.description + ' ' + (analogy[type] || '');
}
function syncMode() { const l = realLookup.checked; $('modeLabel').textContent = l ? 'Live mode: real DNS data' : 'Offline demo: made-up data'; $('modeDot').classList.toggle('muted', !l); }
traceBtn.addEventListener('click', trace);
domainInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') trace(); });
$('clearBtn').addEventListener('click', () => { domainInput.value = ''; domainInput.focus(); });
document.querySelectorAll('.quick button').forEach((b) => b.addEventListener('click', () => { domainInput.value = b.dataset.d; if (!running) trace(); }));
$('resetBtn').addEventListener('click', () => {
  if (running) return; resetJourney(cleanDomain(domainInput.value) || 'example.com', selectedType(), realLookup.checked);
  $('journeyStatus').textContent = 'Ready'; $('journeyMessage').textContent = 'Enter a domain and press Trace DNS.'; $('resultStatus').textContent = 'Waiting for trace';
  $('answerData').textContent = 'Run a trace to see the answer.'; $('modeNote').textContent = 'Ready.';
  logEl.innerHTML = '<div class="log-line i"><span>Queries will appear here as the trace runs.</span></div>'; toast('Trace view reset.');
});
$('flushCacheBtn').addEventListener('click', () => { cache.clear(); renderCache(); toast('Demo cache flushed.'); });
recordSelect.addEventListener('change', () => selectRecord(selectedType()));
realLookup.addEventListener('change', syncMode);
document.querySelectorAll('.record-card').forEach((c) => c.addEventListener('click', () => selectRecord(c.dataset.record)));
$('useRecordBtn').addEventListener('click', () => { recordSelect.scrollIntoView({ behavior: 'smooth', block: 'center' }); recordSelect.focus(); toast(`${selectedType()} selected. Pick a domain and trace it.`); });
$('bottomTrace').addEventListener('click', () => { domainInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); domainInput.focus(); });
window.addEventListener('resize', layout);
resetJourney('example.com', 'A', true); $('journeyStatus').textContent = 'Ready'; $('journeyMessage').textContent = 'Enter a domain and press Trace DNS.'; $('resultStatus').textContent = 'Waiting for trace'; $('answerData').textContent = 'Run a trace to see the answer.'; $('modeNote').textContent = 'Ready.';
logEl.innerHTML = '<div class="log-line i"><span>Queries will appear here as the trace runs.</span></div>';
selectRecord('A', false); syncMode(); renderCache(); setInterval(renderCache, 1000);
