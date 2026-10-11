/* Line Runner — the app.
 * Everything lives in this browser's localStorage. Nothing is uploaded anywhere.
 */
(function () {
  'use strict';
  const P = window.LineParser;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const KEY = 'lineRunner:v1';
  const CUE_TAIL = 14;          // words of a long cue read in "cues only" and flashcards
  const SOLID = 3;              // box at which a line counts as solid

  const DEFAULT_SETTINGS = {
    offBook: '', rate: 1, speakCues: true, showCueText: true, speakMine: false,
    showDirections: true, includeGroup: true, british: true, voiceMap: {}, ignore: '',
    sessionSize: 20, theme: ''
  };

  // ---------------------------------------------------------------- storage

  function load() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { d = {}; }
    return {
      script: typeof d.script === 'string' ? d.script : '',
      me: typeof d.me === 'string' ? d.me : '',
      demo: !!d.demo,
      undo: typeof d.undo === 'string' ? d.undo : null,
      settings: Object.assign({}, DEFAULT_SETTINGS, d.settings || {}),
      progress: d.progress && typeof d.progress === 'object' ? d.progress : {},
      lastDropped: Array.isArray(d.lastDropped) ? d.lastDropped : [],
      tipClosed: !!d.tipClosed
    };
  }

  let S = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
    catch (e) { toast('Couldn’t save on this device. Download a backup from Settings.'); return false; }
  }

  function askPersist() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
  }

  // ---------------------------------------------------------------- derived

  const D = { parsed: null, practice: null, warnings: [], byPos: new Map() };

  function derive() {
    D.parsed = S.script.trim() ? P.parse(S.script, { ignore: S.settings.ignore }) : null;
    if (D.parsed && !S.me && D.parsed.cast.length) { S.me = D.parsed.cast[0].name; save(); }
    const opts = { includeGroup: S.settings.includeGroup };
    D.practice = P.buildPractice(D.parsed, S.me, opts);
    D.warnings = P.lineWarnings(D.parsed, S.me, opts);
    D.byPos = new Map(D.practice.lines.map(l => [l.scene + ':' + l.block, l]));
  }

  function statusOf(key) {
    const p = S.progress[key];
    if (!p || !p.n) return 'new';
    return p.b >= SOLID ? 'solid' : 'learning';
  }

  function tally(keys) {
    const t = { solid: 0, learning: 0, new: 0, total: keys.length };
    for (const k of keys) t[statusOf(k)]++;
    return t;
  }

  function daysLeft() {
    if (!S.settings.offBook) return null;
    const t = new Date(S.settings.offBook + 'T00:00:00');
    if (isNaN(t)) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((t - now) / 86400000);
  }

  // ---------------------------------------------------------------- helpers

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('on'), ms || 2600);
  }

  // Script text with ( … ) directions in italics.
  function lineHTML(text) {
    return P.segments(text).map(s => s.dir ? '<span class="dirt">' + esc(s.s) + '</span>' : esc(s.s)).join(' ');
  }

  // Hint level 1: first letter of each word, the rest as a faint bar.
  function lettersHTML(text) {
    return P.segments(text).map(s => {
      if (s.dir) return '<span class="dirt">' + esc(s.s) + '</span>';
      if (s.punct) return esc(s.s);
      const n = s.mid.length;
      return '<span class="w">' + esc(s.lead) + '<span class="f">' + esc(s.first) + '</span>' +
        (n ? '<span class="b" style="width:' + (n * 0.5).toFixed(2) + 'em"></span>' : '') + esc(s.trail) + '</span>';
    }).join(' ');
  }

  function tail(text, n) {
    const w = text.split(/\s+/);
    return w.length <= n ? text : '…' + w.slice(-n).join(' ');
  }

  function barHTML(t, thin) {
    if (!t.total) return '';
    const pct = n => (100 * n / t.total).toFixed(2) + '%';
    return '<div class="bar' + (thin ? ' thin' : '') + '" role="img" aria-label="' +
      t.solid + ' solid, ' + t.learning + ' learning, ' + t.new + ' new">' +
      '<i class="solid" style="width:' + pct(t.solid) + '"></i><i class="learning" style="width:' + pct(t.learning) + '"></i></div>';
  }

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true ||
    (window.matchMedia && matchMedia('(display-mode: standalone)').matches);

  // ---------------------------------------------------------------- speech

  const TTS = (function () {
    const ok = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Junior|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Kathy|Ralph)\b/i;
    let voices = [];
    let token = 0;
    let unlocked = false;
    const keep = [];

    function refresh() {
      if (!ok) return;
      const before = voices.length;
      voices = speechSynthesis.getVoices().filter(v => /^en([-_]|$)/i.test(v.lang));
      if (voices.length !== before) document.dispatchEvent(new Event('lr-voices'));
    }
    if (ok) {
      refresh();
      if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', refresh);
      else speechSynthesis.onvoiceschanged = refresh;
    }

    function pool() {
      const good = voices.filter(v => !NOVELTY.test(v.name));
      const list = good.length ? good : voices;
      if (!S.settings.british) return list;
      const gb = list.filter(v => /GB|UK|IE/i.test(v.lang) || /UK|British|England/i.test(v.name));
      return gb.concat(list.filter(v => gb.indexOf(v) < 0));
    }

    // Each character keeps the same voice; when voices run out, vary the pitch.
    function voiceFor(speaker) {
      const all = pool();
      const chosen = S.settings.voiceMap[speaker];
      const fixed = chosen && voices.find(v => v.voiceURI === chosen);
      const others = (D.parsed ? D.parsed.cast : []).map(c => c.name).filter(n => n !== S.me);
      let i = others.indexOf(speaker);
      if (speaker === '__me') i = others.length;
      if (i < 0) i = others.length + 1;
      const pitch = 1 + ([0, -0.12, 0.14][Math.floor(i / Math.max(1, all.length)) % 3]);
      return { voice: fixed || all[i % Math.max(1, all.length)] || null, pitch };
    }

    function pieces(text) {
      const parts = text.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g) || [text];
      const out = [];
      for (let p of parts) {
        p = p.trim();
        if (!p) continue;
        while (p.length > 200) {
          let cut = p.lastIndexOf(',', 180);
          if (cut < 60) cut = p.lastIndexOf(' ', 180);
          if (cut < 60) cut = 180;
          out.push(p.slice(0, cut + 1));
          p = p.slice(cut + 1).trim();
        }
        if (out.length && (out[out.length - 1] + ' ' + p).length < 120) out[out.length - 1] += ' ' + p;
        else out.push(p);
      }
      return out;
    }

    function utter(text, v, rate) {
      return new Promise(resolve => {
        const u = new SpeechSynthesisUtterance(text);
        if (v.voice) { u.voice = v.voice; u.lang = v.voice.lang; }
        u.pitch = v.pitch;
        u.rate = rate;
        let done = false;
        const fin = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
        u.onend = fin;
        u.onerror = fin;
        keep.push(u); if (keep.length > 30) keep.shift();     // Chrome drops events on collected utterances
        const t = setTimeout(fin, 2500 + text.split(/\s+/).length * 650 / rate);
        speechSynthesis.speak(u);
      });
    }

    async function say(text, speaker) {
      if (!ok || !text) return;
      const my = ++token;
      const v = voiceFor(speaker);
      const rate = Number(S.settings.rate) || 1;
      for (const p of pieces(text)) {
        if (my !== token) return;
        await utter(p, v, rate);
      }
    }

    function cancel() {
      token++;
      if (ok) { try { speechSynthesis.cancel(); } catch (e) {} }
    }

    // iOS only speaks after a tap; prime it inside the first tap.
    function unlock() {
      if (!ok || unlocked) return;
      unlocked = true;
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
    }

    return { ok, say, cancel, unlock, voices: () => voices, refresh };
  }());

  // ---------------------------------------------------------------- router

  const views = { home: viewHome, script: viewScript, settings: viewSettings, help: viewHelp };

  function route() {
    const r = location.hash.replace(/^#\/?/, '') || 'home';
    return views[r] ? r : 'home';
  }

  function render(keepScroll) {
    const r = route();
    $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.r === r));
    const y = window.scrollY;
    views[r]($('#view'));
    window.scrollTo(0, keepScroll ? y : 0);
    renderChip();
  }

  function renderChip() {
    const chip = $('#chip');
    const dl = daysLeft();
    if (dl === null || dl < 0) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = dl === 0 ? 'Off-book today' : plural(dl, 'day') + ' to off-book';
  }

  window.addEventListener('hashchange', () => render());

  // ---------------------------------------------------------------- views

  function viewHome(el) {
    const tip = isIOS && !standalone && !S.tipClosed && S.script
      ? '<div class="banner"><b>Tip:</b> tap Share → <b>Add to Home Screen</b>. Safari can clear a website’s saved data if you don’t open it for a week; a Home Screen app keeps your script safe.<div class="row"><button class="btn small" data-act="closeTip">Got it</button></div></div>'
      : '';

    if (!D.parsed) {
      el.innerHTML = tip + `
        <section class="card hero">
          <h1>Learn your lines.</h1>
          <p>Line Runner reads your cues out loud and waits for you to say your line. It keeps track of the lines you know and drills the ones you don’t.</p>
          <ol class="small">
            <li>Photograph a page of your script.</li>
            <li>On iPhone, open the photo, press and hold on the words, then <b>Select All</b> → <b>Copy</b>.</li>
            <li>Paste it on the <b>Script</b> tab. Add pages in order.</li>
          </ol>
          <div class="row">
            <a class="btn primary" href="#/script">Add my script</a>
            <button class="btn" data-act="demo">Try a demo scene</button>
          </div>
          <p class="muted small" style="margin-top:12px">Your script stays on this device. Nothing is uploaded.</p>
        </section>`;
      return;
    }

    const lines = D.practice.lines;
    const demo = S.demo ? '<div class="banner">This is a <b>demo scene</b>. When you add your own pages, the demo is cleared.<div class="row"><button class="btn small" data-act="clearDemo">Remove demo</button></div></div>' : '';
    if (!lines.length) {
      el.innerHTML = tip + demo + `<section class="card"><h2>No lines for ${esc(S.me || 'you')} yet</h2>
        <p class="muted">Pick your character on the Script tab, or add the pages your character is on.</p>
        <a class="btn primary" href="#/script">Go to Script</a></section>`;
      return;
    }

    const t = tally(lines.map(l => l.key));
    const dl = daysLeft();
    let count;
    if (dl === null) count = '<a href="#/settings">Set your off-book date</a>';
    else if (dl > 0) count = '<b>' + dl + '</b> ' + (dl === 1 ? 'day' : 'days') + ' to off-book';
    else if (dl === 0) count = '<b>Off-book day!</b>';
    else count = 'Off-book date has passed — keep it sharp.';
    const left = t.total - t.solid;
    const pace = dl > 0 && left > 0
      ? '<p class="muted small">Solid means you got it right 3 times. About <b>' + plural(Math.ceil(left / dl), 'line') + ' a day</b> gets you there.</p>'
      : (left === 0 ? '<p class="muted small">Every line is solid. Run whole scenes with the cue text off to keep it that way.</p>' : '');

    const chunks = D.practice.chunks.map((c, i) => ({ c, i })).filter(x => x.c.keys.length);
    const hidden = D.practice.chunks.length - chunks.length;

    el.innerHTML = tip + demo + `
      <section class="card hero">
        <div class="count">${count}</div>
        <div class="big">${t.solid} of ${plural(t.total, 'line')} solid</div>
        ${barHTML(t)}
        <div class="legend"><span><i style="background:var(--got)"></i>solid ${t.solid}</span><span><i style="background:var(--shaky)"></i>learning ${t.learning}</span><span><i style="background:var(--new)"></i>new ${t.new}</span></div>
        ${pace}
        <div class="row">
          <button class="btn primary" data-act="quick">Practice my weakest ${Math.min(S.settings.sessionSize, t.total)}</button>
          <button class="btn" data-act="pickAll">Whole script…</button>
        </div>
      </section>
      <div class="sect-title"><h2>Sections</h2><span class="muted small">${esc(S.me)} · tap one to practice</span></div>
      ${chunks.map(({ c, i }) => {
        const ct = tally(c.keys);
        return `<button class="scene" data-act="pick" data-chunk="${i}">
          <div class="t"><b>${esc(c.title)}</b><span>${ct.solid}/${plural(ct.total, 'line')}</span></div>
          ${barHTML(ct, true)}</button>`;
      }).join('')}
      ${hidden ? '<p class="muted small">' + plural(hidden, 'section') + ' without ' + esc(S.me) + ' not shown.</p>' : ''}`;
  }

  function viewScript(el) {
    const p = D.parsed;
    const speeches = p ? p.scenes.reduce((n, s) => n + s.blocks.filter(b => b.type === 'speech').length, 0) : 0;
    const mine = D.practice.lines.length;
    const warn = D.warnings;
    const unclosed = p ? p.warnings.filter(w => w.kind === 'unclosed') : [];

    el.innerHTML = `
      <section class="card">
        <h2>Your script</h2>
        ${p ? `<p class="muted small">${plural(p.scenes.length, 'section')} · ${plural(speeches, 'line')} · <b>${mine} ${S.me ? 'are ' + esc(S.me) + '’s' : ''}</b></p>`
            : '<p class="muted">Nothing here yet. Paste your first page below.</p>'}
        ${p ? `<label class="field"><span>I’m playing</span><select data-change="me">${
          p.cast.map(c => '<option value="' + esc(c.name) + '"' + (c.name === S.me ? ' selected' : '') + '>' + esc(c.name) + ' (' + c.lines + ')</option>').join('')
        }</select></label>` : ''}
      </section>

      <section class="card">
        <h3>Add pages</h3>
        <p class="muted small">On iPhone: open the photo, press and hold on the words, tap <b>Select All</b>, then <b>Copy</b>. Paste below and tap Add. Go in page order — one page or several at a time.</p>
        <textarea id="addText" rows="6" placeholder="Paste the copied page here…" autocapitalize="off" spellcheck="false"></textarea>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" data-act="add">Add to script</button>
          ${S.undo !== null ? '<button class="btn" data-act="undo">Undo last add</button>' : ''}
        </div>
        ${S.lastDropped.length ? `<p class="muted small" style="margin:10px 0 0">Skipped from your last paste (probably pencil notes): ${
          S.lastDropped.map(d => '“' + esc(d) + '”').join(', ')}. If any of these were real script words, put them back with <b>Edit text</b>.</p>` : ''}
      </section>

      ${warn.length || unclosed.length ? `<section class="card">
        <h3>Check ${plural(warn.length + unclosed.length, 'spot')}</h3>
        <p class="muted small">These might be cleanup mistakes. Tap <b>Show</b>, then use <b>Edit text</b> to fix any that are wrong.</p>
        <ul class="warnlist">
          ${warn.map(w => `<li><span class="spacer">${esc(w.msg)}</span><button class="btn small" data-act="showBlock" data-pos="${w.scene}:${w.block}">Show</button></li>`).join('')}
          ${unclosed.map(w => `<li><span class="spacer">A stage direction was missing its closing “)”: <i>${esc(w.text)}…</i></span></li>`).join('')}
        </ul></section>` : ''}

      ${p ? `<section class="card">
        <div class="row"><h3 class="spacer" style="margin:0">Read through</h3>
          <button class="btn" data-act="edit">Edit text</button></div>
        <p class="muted small">Your lines are highlighted. Check that each line belongs to the right person and that stage directions are in ( ). If a title page, cast list, music list or notes got in, use <b>Remove section</b>.</p>
        <div id="pvwrap" class="preview">${previewHTML()}</div>
      </section>` : ''}`;
  }

  function previewHTML() {
    const warnAt = new Set(D.warnings.map(w => w.scene + ':' + w.block));
    let page = null;
    return D.parsed.scenes.map((s, si) => {
      const n = s.blocks.filter(b => b.type === 'speech').length;
      let h = '<div class="pvh"><h3>' + (s.title ? esc(s.title) : '<i>Before the first heading</i>') + '</h3>' +
        '<button class="btn small ghost" data-act="removeSection" data-si="' + si + '" data-n="' + n + '">Remove section</button></div>';
      h += s.blocks.map((b, bi) => {
        let pg = '';
        if (b.page != null && b.page !== page) { page = b.page; pg = '<div class="pg">page ' + b.page + '</div>'; }
        const id = 'pv-' + si + '-' + bi;
        const w = warnAt.has(si + ':' + bi) ? ' warn' : '';
        if (b.type === 'direction') return pg + '<div class="pv dir" id="' + id + '">' + esc(P.wrapDirection(b.text)) + '</div>';
        const mine = P.isMine(b.speaker, S.me, S.settings.includeGroup) ? ' mine' : '';
        return pg + '<div class="pv' + mine + w + '" id="' + id + '"><span class="who">' + esc(b.speaker) + '</span>' + lineHTML(b.text) + '</div>';
      }).join('');
      return h;
    }).join('');
  }

  function editScript() {
    const card = $('#pvwrap').parentElement;
    card.innerHTML = `
      <h3>Edit text</h3>
      <p class="muted small">One line per speech: <b>NAME: what they say</b>. Stage directions go in ( ). A line starting with <b>#</b> is a section heading. <b>Page 12</b> on its own line marks a page. Delete anything that isn’t in the script (like pencil notes).</p>
      <textarea id="editText" class="script-edit" spellcheck="false" autocapitalize="off">${esc(S.script)}</textarea>
      <div class="row end" style="margin-top:8px">
        <button class="btn" data-act="cancelEdit">Cancel</button>
        <button class="btn primary" data-act="saveEdit">Save</button>
      </div>`;
    $('#editText').focus();
  }

  function viewSettings(el) {
    const s = S.settings;
    const cast = D.parsed ? D.parsed.cast.map(c => c.name).filter(n => n !== S.me) : [];
    const voices = TTS.voices();
    const voiceOpts = sel => '<option value="">Automatic</option>' + voices.map(v =>
      '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === sel ? ' selected' : '') + '>' + esc(v.name) + ' (' + esc(v.lang) + ')</option>').join('');
    el.innerHTML = `
      <section class="card">
        <h2>Practice</h2>
        ${D.parsed ? `<label class="field"><span>I’m playing</span><select data-change="me">${
          D.parsed.cast.map(c => '<option value="' + esc(c.name) + '"' + (c.name === S.me ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('')}</select></label>` : ''}
        <label class="field"><span>Off-book date</span><input type="date" data-change="offBook" value="${esc(s.offBook)}"></label>
        <label class="check"><input type="checkbox" data-change="speakCues" ${s.speakCues ? 'checked' : ''}><span>Read cues out loud</span></label>
        <label class="check"><input type="checkbox" data-change="showCueText" ${s.showCueText ? 'checked' : ''}><span>Show the cue text <span class="muted small">(turn off to practice by ear, like a real scene)</span></span></label>
        <label class="check"><input type="checkbox" data-change="speakMine" ${s.speakMine ? 'checked' : ''}><span>Read my line back after I check it</span></label>
        <label class="check"><input type="checkbox" data-change="showDirections" ${s.showDirections ? 'checked' : ''}><span>Show stage directions when running a scene</span></label>
        <label class="check"><input type="checkbox" data-change="includeGroup" ${s.includeGroup ? 'checked' : ''}><span>Count lines for ALL / BOTH / COMPANY as mine</span></label>
        <label class="field"><span>Lines in a quick practice</span><input type="number" min="5" max="100" step="5" data-change="sessionSize" value="${esc(s.sessionSize)}"></label>
      </section>

      <section class="card">
        <h2>Voices</h2>
        ${TTS.ok ? `
        <label class="field"><span>Speed: <b id="rateOut">${Number(s.rate).toFixed(1)}×</b></span><input type="range" min="0.6" max="1.6" step="0.1" data-change="rate" value="${esc(s.rate)}"></label>
        <label class="check"><input type="checkbox" data-change="british" ${s.british ? 'checked' : ''}><span>Prefer British voices</span></label>
        ${cast.length ? '<p class="muted small">Each character keeps their own voice. Change any of them here.</p>' : ''}
        ${cast.slice(0, 16).map(n => `<label class="field"><span>${esc(n)}</span><div class="row nowrap"><select class="vsel" data-voice="${esc(n)}">${voiceOpts(s.voiceMap[n])}</select><button class="btn" data-act="testVoice" data-name="${esc(n)}">Test</button></div></label>`).join('')}
        ${voices.length ? '' : '<p class="muted small">No voices loaded yet. They usually appear after a moment.</p>'}
        ` : '<p class="muted">This browser can’t read aloud. Cues will show as text instead.</p>'}
      </section>

      <section class="card">
        <h2>Script cleanup</h2>
        <label class="field"><span>Skip lines containing</span><input type="text" data-change="ignore" value="${esc(s.ignore)}" placeholder="e.g. the play’s title from the top of each page"></label>
        <p class="muted small">Separate with commas. Repeating page headers are found automatically and added here.</p>
      </section>

      <section class="card">
        <h2>Backup &amp; moving devices</h2>
        <p class="muted small">Your script and progress live only in this browser. To use another device, either copy the script text and paste it into <b>Add pages</b> there, or download a backup and restore it there (that brings your progress too).</p>
        <div class="row">
          <button class="btn" data-act="copyScript" ${S.script ? '' : 'disabled'}>Copy script text</button>
          <button class="btn" data-act="exportBackup" ${S.script ? '' : 'disabled'}>Download backup</button>
          <label class="btn">Restore backup<input type="file" accept=".json,application/json" data-change="importBackup" hidden></label>
        </div>
      </section>

      <section class="card">
        <h2>Start over</h2>
        <div class="row">
          <button class="btn danger" data-act="resetProgress">Reset progress</button>
          <button class="btn danger" data-act="eraseAll">Erase everything</button>
        </div>
      </section>`;
  }

  function viewHelp(el) {
    el.innerHTML = `
      <section class="card help">
        <h2>Getting your script in</h2>
        <ol>
          <li><b>Photograph the pages</b> in good light, one page or a two-page spread per photo. Start at the first page of the play — skip the title page, cast list, and any notes or music lists.</li>
          <li>Open the photo. Press and hold on the words until they highlight, drag the handles if needed, then tap <b>Select All</b> → <b>Copy</b>.</li>
          <li>Here, go to <b>Script → Add pages</b>, paste, and tap <b>Add to script</b>. Keep going in page order. You can paste several pages at once.</li>
          <li>Pasted the wrong page? <b>Undo last add</b>. Front pages or notes got in? <b>Remove section</b> in the read-through.</li>
        </ol>
        <p><b>Lots of photos?</b> An iPhone Shortcut can copy the text from all of them at once. Put the photos in an album, then build a Shortcut: <b>Find Photos</b> (album is yours, sorted by date taken) → <b>Repeat with Each</b> → <b>Extract Text from Image</b> → <b>Combine Text</b> (new lines) → <b>Copy to Clipboard</b>. Run it, then paste everything in one go.</p>
        <h3>Checking it</h3>
        <p>Read through on the Script tab. Your lines are highlighted. Look at any <b>Check</b> spots first. Pencil notes in your script can sneak in as words; delete them with <b>Edit text</b>. In Edit text, each speech is one line: <b>MARY: what she says</b>, and stage directions go in ( ).</p>

        <h3>Practicing</h3>
        <ul>
          <li><b>Run the scene</b> — hear every line in order. When it’s your turn, say your line out loud, then check it.</li>
          <li><b>Cues only</b> — skips straight to the line before each of yours. Faster.</li>
          <li><b>Flashcards</b> — see or hear your cue, say your line. Lines you miss come back a few cards later.</li>
          <li><b>Type first letters</b> — type the first letter of each word of your line. It catches every little slip.</li>
        </ul>
        <p>Always say lines <b>out loud</b>. Be honest when you grade: <b>Got it</b> means word-perfect. A line is <b>solid</b> after you get it right 3 times.</p>
        <p><b>Hint</b> shows the first letter of each word. Press it again to see the whole line.</p>
        <h3>A routine that works</h3>
        <ol>
          <li>Learn a new section: <b>Run the scene</b> with cue text on, using hints freely.</li>
          <li>Then <b>Flashcards</b> on that section until most lines are green.</li>
          <li>Every day: <b>Practice my weakest</b> to keep old sections fresh.</li>
          <li>The week before off-book: run whole acts with <b>Show the cue text</b> turned off (Settings), so you learn your cues by ear.</li>
        </ol>
        <p class="kbdlist">On a Chromebook: <b>Space</b> show line / next · <b>H</b> hint · <b>1 2 3</b> missed / shaky / got it · <b>R</b> replay cue · <b>Esc</b> stop.</p>

        <h3>iPhone and Chromebook</h3>
        <ul>
          <li>On iPhone, tap Share → <b>Add to Home Screen</b>. Safari can clear a website’s data if you don’t open it for a week; the Home Screen app keeps it.</li>
          <li>Each device keeps its own copy. Move your script with <b>Settings → Download backup</b>, then <b>Restore backup</b> on the other device (email the file to yourself, or put it in Google Drive). Or copy the script text and paste it into <b>Add pages</b>.</li>
        </ul>
        <h3>Privacy</h3>
        <p>Your script never leaves this device. There are no accounts, no tracking, and nothing is uploaded. Your script is for your own practice — please don’t share its text.</p>
      </section>`;
  }

  // ---------------------------------------------------------------- script actions

  function mergeIgnore(current, learned) {
    const have = current.split(',').map(s => s.trim()).filter(Boolean);
    for (const l of learned) if (!have.some(h => h.toLowerCase() === l.toLowerCase())) have.push(l);
    return have.join(', ');
  }

  function speechCount(parsed) {
    return parsed ? parsed.scenes.reduce((n, s) => n + s.blocks.filter(b => b.type === 'speech').length, 0) : 0;
  }

  function addPages() {
    const ta = $('#addText');
    const text = ta.value;
    if (!text.trim()) { toast('Paste a page first.'); ta.focus(); return; }
    if (S.demo) { S.script = ''; S.me = ''; S.progress = {}; S.demo = false; S.undo = null; derive(); }
    const beforeLines = speechCount(D.parsed);
    const beforeMine = D.practice.lines.length;
    S.undo = S.script;
    const parsed = P.parse(S.script + '\n' + text, { ignore: S.settings.ignore });
    if (parsed.learned.length) S.settings.ignore = mergeIgnore(S.settings.ignore, parsed.learned);
    S.script = P.serialize(parsed);
    S.lastDropped = (parsed.dropped || []).slice(0, 40);
    save(); askPersist(); derive();
    const added = speechCount(D.parsed) - beforeLines;
    const addedMine = D.practice.lines.length - beforeMine;
    render(true);
    const skipped = S.lastDropped.length ? ' · skipped ' + plural(S.lastDropped.length, 'pencil mark') : '';
    toast(added > 0 ? 'Added ' + plural(added, 'line') + (S.me ? ' (' + addedMine + ' ' + S.me + ')' : '') + skipped : 'Added. No new speeches found — check the read-through.', 3500);
  }

  function undoAdd() {
    if (S.undo === null) return;
    S.script = S.undo;
    S.undo = null;
    S.lastDropped = [];
    save(); derive(); render(true);
    toast('Last add undone.');
  }

  function saveEdit() {
    const v = $('#editText').value;
    S.undo = S.script;
    const parsed = P.parse(v, { ignore: S.settings.ignore });
    if (parsed.learned.length) S.settings.ignore = mergeIgnore(S.settings.ignore, parsed.learned);
    S.script = P.serialize(parsed);
    if (D.parsed && !parsed.cast.some(c => c.name === S.me)) S.me = '';
    save(); derive(); render(true);
    toast('Saved.');
  }

  function showBlock(pos) {
    const [si, bi] = pos.split(':');
    const el = document.getElementById('pv-' + si + '-' + bi);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  const DEMO = `# The Lighthouse Key — demo scene
(Lights rise on a rocky shore. WREN sits on an upturned boat, scowling at the sea.)
KEEPER: You'll catch your death sitting out here, miss.
WREN: I don't care. Nobody asked me if I wanted to come to this horrid island.
KEEPER: (gently) Nobody asks the tide, either. Still it comes.
WREN: That's a stupid thing to say. (She turns away.) Everything here is grey.
(MRS. HOLLOWAY enters with a lantern.)
MRS. HOLLOWAY: There you are! Supper has been on the table this half hour.
WREN: I'm not hungry.
MRS. HOLLOWAY: Hungry or not, you'll sit.
WREN: Who lives in the tower with the red door?
KEEPER: Nobody, these ten years. The key was lost the winter the old keeper went away. (He stops himself.) Well. It was lost.
WREN: Lost where?
KEEPER: If I knew that, it wouldn't be lost, would it? Off you go now. Mind the rocks; they're slippery after dark.
WREN: I'm going to find it.
KEEPER: Are you, now.
WREN: I am. And when I do, I won't tell you.
`;

  // ---------------------------------------------------------------- practice: setup

  let sess = null;
  let wake = null;

  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator) wake = await navigator.wakeLock.request('screen');
      else if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) {}
  }

  function weakness(key) {
    const p = S.progress[key];
    if (!p || !p.n) return 0.5;                        // new lines after recent misses
    return p.b + (p.b === 0 ? 0 : 0.6);
  }

  function pickLines(keys, order, size) {
    let arr = keys.slice();
    if (order === 'weak') {
      const r = new Map(arr.map(k => [k, Math.random()]));
      arr.sort((a, b) => weakness(a) - weakness(b) ||
        ((S.progress[a] || {}).t || 0) - ((S.progress[b] || {}).t || 0) || r.get(a) - r.get(b));
    } else if (order === 'shuffle') {
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    }
    if (size && arr.length > size) arr = arr.slice(0, size);
    return arr.map(k => D.practice.byKey.get(k)).filter(Boolean);
  }

  function openSheet(chunkIdxs, title) {
    const keys = chunkIdxs.flatMap(i => D.practice.chunks[i].keys);
    const s = S.settings;
    const sheet = $('#sheet');
    sheet.innerHTML = `
      <div class="sheet-bg" data-act="closeSheet">
        <div class="sheet" role="dialog" aria-label="Practice ${esc(title)}">
          <div class="row"><h2 class="spacer" style="margin:0">${esc(title)}</h2><button class="iconbtn" data-act="closeSheet" aria-label="Close">${ICON.x}</button></div>
          <p class="muted small">${plural(keys.length, 'line')} for ${esc(S.me)} · ${tally(keys).solid} solid</p>
          <button class="mode" data-act="go" data-mode="run"><span class="ic">▶︎</span><span><b>Run the scene</b><span>Hear every line in order. Say yours when it’s your turn.</span></span></button>
          <button class="mode" data-act="go" data-mode="cues"><span class="ic">⏭︎</span><span><b>Cues only</b><span>Jump from cue to cue. Faster.</span></span></button>
          <button class="mode" data-act="go" data-mode="cards"><span class="ic">❐</span><span><b>Flashcards</b><span>Your lines one at a time. Misses come back.</span></span></button>
          <button class="mode" data-act="go" data-mode="type"><span class="ic">⌨︎</span><span><b>Type first letters</b><span>Type the first letter of each word. Catches every slip.</span></span></button>
          <label class="field" style="margin-top:10px"><span>Flashcard order</span>
            <select id="ordSel"><option value="order">Script order</option><option value="weak">Weakest first</option><option value="shuffle">Shuffled</option></select></label>
          <label class="check"><input type="checkbox" data-change="speakCues" ${s.speakCues ? 'checked' : ''}><span>Read cues out loud</span></label>
          <label class="check"><input type="checkbox" data-change="showCueText" ${s.showCueText ? 'checked' : ''}><span>Show cue text</span></label>
        </div>
      </div>`;
    sheet.hidden = false;
    sheet.dataset.chunks = chunkIdxs.join(',');
    sheet.dataset.title = title;
    if (chunkIdxs.length > 1) $('#ordSel').value = 'weak';
  }

  function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; }

  function startPractice(cfg) {
    TTS.unlock();
    TTS.cancel();
    closeSheet();
    sess = {
      mode: cfg.mode, title: cfg.title, gen: 0, results: new Map(), attempts: 0,
      paused: false, cur: null, cfg
    };
    if (cfg.mode === 'run' || cfg.mode === 'cues') {
      sess.items = [];
      for (const ci of cfg.chunks) {
        const c = D.practice.chunks[ci];
        const scene = D.parsed.scenes[c.scene];
        sess.items.push({ heading: c.title });
        for (let bi = c.from; bi < c.to; bi++) {
          sess.items.push({ b: scene.blocks[bi], line: D.byPos.get(c.scene + ':' + bi) || null });
        }
      }
      sess.total = sess.items.filter(it => it.line).length;
      sess.i = 0;
    } else {
      const keys = cfg.keys || cfg.chunks.flatMap(i => D.practice.chunks[i].keys);
      sess.queue = pickLines(keys, cfg.order || 'order', cfg.size || 0);
      sess.retries = new Map();
      sess.total = sess.queue.length;
      sess.qi = 0;
    }
    if (!sess.total) { toast('No lines to practice here.'); sess = null; return; }
    const pr = $('#practice');
    pr.innerHTML = `
      <div class="p-head">
        <button class="iconbtn" data-act="stop" aria-label="Stop">${ICON.x}</button>
        <div class="ttl">${esc(cfg.title)}</div>
        <div class="prog" id="prog"></div>
        ${TTS.ok ? '<button class="iconbtn" data-act="togglePause" id="pauseBtn" aria-label="Pause">' + ICON.pause + '</button>' : ''}
      </div>
      <div class="p-body" id="pbody"><div class="in" id="feed"></div></div>
      <div class="p-foot"><div class="in" id="controls"></div></div>`;
    pr.hidden = false;
    document.body.style.overflow = 'hidden';
    keepAwake(true);
    updateProg();
    if (sess.mode === 'run' || sess.mode === 'cues') runStep();
    else nextCard();
  }

  function stopPractice(showSummary) {
    if (!sess) return;
    if (sess.done) { closePractice(); return; }
    TTS.cancel();
    sess.gen++;
    if (showSummary && sess.results.size) { summary(); return; }
    closePractice();
  }

  function closePractice() {
    TTS.cancel();
    sess = null;
    const pr = $('#practice');
    pr.hidden = true;
    pr.innerHTML = '';
    document.body.style.overflow = '';
    keepAwake(false);
    render(true);
  }

  function updateProg() {
    const el = $('#prog');
    if (el && sess) el.textContent = Math.min(sess.results.size, sess.total) + ' / ' + sess.total;
  }

  function controls(btns) {
    $('#controls').innerHTML = btns.map(b =>
      '<button class="btn ' + (b.cls || '') + '" data-act="' + b.act + '"' + (b.data ? ' data-v="' + b.data + '"' : '') + '>' +
      b.label + (b.key ? ' <kbd>' + b.key + '</kbd>' : '') + '</button>').join('');
  }

  function feed(html) {
    const f = $('#feed');
    f.insertAdjacentHTML('beforeend', html);
    const body = $('#pbody');
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
    return f.lastElementChild;
  }

  // ---------------------------------------------------------------- practice: run

  function nextIsMine(i) {
    for (let j = i + 1; j < sess.items.length; j++) {
      const it = sess.items[j];
      if (it.heading) return false;
      if (it.b.type === 'speech' && /[A-Za-z0-9]/.test(P.spoken(it.b.text))) return !!it.line;
    }
    return false;
  }

  function runStep() {
    if (!sess) return;
    const gen = ++sess.gen;
    while (sess.i < sess.items.length) {
      const it = sess.items[sess.i];
      if (it.heading) {
        if (sess.mode === 'run' || sess.i === 0) feed('<div class="fh">' + esc(it.heading) + '</div>');
        sess.i++; continue;
      }
      const b = it.b;
      if (b.type === 'direction') {
        if (sess.mode === 'run' && S.settings.showDirections) feed('<div class="say direction">' + esc(P.wrapDirection(b.text)) + '</div>');
        sess.i++; continue;
      }
      if (it.line) { myTurn(it.line); return; }
      const said = P.spoken(b.text);
      if (!/[A-Za-z0-9]/.test(said)) {
        if (sess.mode === 'run') feed('<div class="say other dim"><div class="who">' + esc(b.speaker) + '</div><div class="txt">' + lineHTML(b.text) + '</div></div>');
        sess.i++; continue;
      }
      if (sess.mode === 'cues' && !nextIsMine(sess.i)) { sess.i++; continue; }
      const cueText = sess.mode === 'cues' ? tail(said, CUE_TAIL) : said;
      const shown = S.settings.showCueText
        ? (sess.mode === 'cues' ? esc(cueText) : lineHTML(b.text))
        : '<span class="listen" data-act="revealCue" data-text="' + esc(sess.mode === 'cues' ? cueText : b.text) + '">🔊 listen… <span class="small">(tap to read)</span></span>';
      const node = feed('<div class="say other"><div class="who">' + esc(b.speaker) + '</div><div class="txt">' + shown + '</div></div>');
      if (S.settings.speakCues && TTS.ok && !sess.paused) {
        node.classList.add('speaking');
        controls([{ label: 'Skip ▸', act: 'skip', key: 'Space' }]);
        TTS.say(cueText, b.speaker).then(() => {
          node.classList.remove('speaking');
          if (sess && gen === sess.gen && !sess.paused) { sess.i++; runStep(); }
        });
      } else {
        controls([{ label: 'Next ▸', act: 'skip', key: 'Space', cls: 'primary' }]);
      }
      return;
    }
    summary();
  }

  function skip() {
    if (!sess) return;
    TTS.cancel();
    sess.paused = false;
    setPauseIcon();
    sess.i++;
    runStep();
  }

  function togglePause() {
    if (!sess) return;
    if (!sess.paused) {
      sess.paused = true;
      sess.gen++;
      TTS.cancel();
      $$('.speaking').forEach(n => n.classList.remove('speaking'));
      if (sess.mode === 'run' || sess.mode === 'cues') {
        if (!sess.cur) controls([{ label: 'Resume', act: 'togglePause', cls: 'primary', key: 'Space' }]);
      }
    } else {
      sess.paused = false;
      if ((sess.mode === 'run' || sess.mode === 'cues') && !sess.cur) {
        // Re-read the line that was interrupted.
        const it = sess.items[sess.i];
        const node = $('#feed').lastElementChild;
        if (it && it.b && node && TTS.ok && S.settings.speakCues) {
          const gen = ++sess.gen;
          const said = P.spoken(it.b.text);
          node.classList.add('speaking');
          controls([{ label: 'Skip ▸', act: 'skip', key: 'Space' }]);
          TTS.say(sess.mode === 'cues' ? tail(said, CUE_TAIL) : said, it.b.speaker).then(() => {
            node.classList.remove('speaking');
            if (sess && gen === sess.gen && !sess.paused) { sess.i++; runStep(); }
          });
        } else runStep();
      }
    }
    setPauseIcon();
  }

  function setPauseIcon() {
    const b = $('#pauseBtn');
    if (b && sess) { b.innerHTML = sess.paused ? ICON.play : ICON.pause; b.setAttribute('aria-label', sess.paused ? 'Resume' : 'Pause'); }
  }

  // ---------------------------------------------------------------- practice: my turn

  function myCardHTML(line, level, grade) {
    let txt;
    if (level === 0) {
      const dirs = P.segments(line.text).filter(s => s.dir).map(s => s.s);
      txt = '<span class="prompt">Your line — say it out loud.</span>' +
        (dirs.length ? ' <span class="dirt">' + esc(dirs[0]) + '</span>' : '');
    } else if (level === 1) txt = lettersHTML(line.text);
    else txt = lineHTML(line.text);
    const pg = line.page != null ? '<span>p. ' + line.page + '</span>' : '';
    return '<div class="mycard' + (grade != null ? ' g-' + grade : '') + '"><div class="who">' + esc(line.speaker) +
      '</div><div class="txt">' + txt + '</div><div class="meta"><span>' + plural(line.words, 'word') + '</span>' + pg + '</div></div>';
  }

  function myTurn(line) {
    sess.cur = { line, level: 0, node: null };
    if (sess.mode === 'run' || sess.mode === 'cues') {
      sess.cur.node = feed(myCardHTML(line, 0));
    }
    turnControls();
  }

  function turnControls() {
    const c = sess.cur;
    if (c.level < 2) {
      controls([
        { label: c.level === 0 ? 'Hint' : 'More', act: 'hint', key: 'H' },
        { label: 'Show line', act: 'reveal', key: 'Space', cls: 'primary' }
      ]);
    } else {
      controls([
        { label: 'Missed', act: 'grade', data: 0, key: '1', cls: 'g0' },
        { label: 'Shaky', act: 'grade', data: 1, key: '2', cls: 'g1' },
        { label: 'Got it', act: 'grade', data: 2, key: '3', cls: 'g2' }
      ]);
    }
  }

  function redrawCard() {
    const c = sess.cur;
    const html = myCardHTML(c.line, c.level);
    if (c.node) { c.node.outerHTML = html; c.node = $('#feed').lastElementChild; }
    else { const m = $('#mycard'); if (m) m.innerHTML = html; }
    const body = $('#pbody');
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  }

  function hint() {
    if (!sess || !sess.cur || sess.cur.level >= 2) return;
    sess.cur.level++;
    sess.cur.hinted = true;
    if (sess.cur.level >= 2) { reveal(); return; }
    redrawCard();
    turnControls();
  }

  function reveal() {
    if (!sess || !sess.cur) return;
    sess.cur.level = 2;
    redrawCard();
    turnControls();
    if (S.settings.speakMine && TTS.ok) TTS.say(sess.cur.line.spoken, '__me');
  }

  function record(key, g) {
    if (sess.results.has(key)) return;                 // only a line's first try counts
    sess.results.set(key, g);
    const p = S.progress[key] || { b: 0, n: 0, m: 0, t: 0 };
    if (g === 2) p.b = Math.min(5, p.b + 1);
    else if (g === 1) p.b = p.b > 1 ? p.b - 1 : p.b;
    else p.b = 0;
    p.n++;
    if (g === 0) p.m++;
    p.t = Date.now();
    S.progress[key] = p;
    save();
    updateProg();
  }

  function grade(g) {
    if (!sess || !sess.cur || sess.cur.level < 2) return;
    TTS.cancel();
    const line = sess.cur.line;
    record(line.key, g);
    if (sess.mode === 'run' || sess.mode === 'cues') {
      const n = sess.cur.node;
      if (n) n.classList.add('g-' + g);
      sess.cur = null;
      sess.i++;
      runStep();
    } else {
      requeue(line, g);
      sess.cur = null;
      sess.qi++;
      nextCard();
    }
  }

  function requeue(line, g) {
    const tries = sess.retries.get(line.key) || 0;
    if (g === 2 || tries >= 2 || (g === 1 && tries >= 1)) return;
    sess.retries.set(line.key, tries + 1);
    const at = Math.min(sess.queue.length, sess.qi + 1 + (g === 0 ? 3 : 5));
    sess.queue.splice(at, 0, line);
  }

  // ---------------------------------------------------------------- practice: cards

  function cueHTML(line) {
    if (!line.cue) {
      return '<div class="cuebox"><div class="say"><div class="who">START OF SECTION</div>' +
        (line.context ? '<div class="txt dirt">' + esc(P.wrapDirection(line.context)) + '</div>' : '<div class="txt muted">You speak first.</div>') + '</div></div>';
    }
    const said = P.spoken(line.cue.text);
    const short = tail(said, CUE_TAIL);
    const who = line.cue.mine ? 'YOU (your line before)' : line.cue.speaker;
    const body = S.settings.showCueText
      ? '<div class="txt" id="cueTxt">' + esc(short) + '</div>' +
        (short !== said ? '<button class="more" data-act="fullCue">Show whole line</button>' : '')
      : '<div class="txt listen" data-act="revealCue" data-text="' + esc(short) + '">🔊 listen… <span class="small">(tap to read)</span></div>';
    return '<div class="cuebox"><div class="say" style="margin:0"><div class="who">' + esc(who) +
      (TTS.ok ? ' <button class="iconbtn" style="width:32px;height:32px" data-act="replay" aria-label="Replay cue">' + ICON.speaker + '</button>' : '') +
      '</div>' + body + '</div></div>';
  }

  function speakCue(line) {
    if (!line.cue || !S.settings.speakCues || !TTS.ok || line.cue.mine) return;
    TTS.say(tail(P.spoken(line.cue.text), CUE_TAIL), line.cue.speaker);
  }

  function nextCard() {
    if (!sess) return;
    if (sess.qi >= sess.queue.length) { summary(); return; }
    const line = sess.queue[sess.qi];
    sess.cur = { line, level: 0, node: null };
    const f = $('#feed');
    f.innerHTML = cueHTML(line) + (sess.mode === 'type' ? typeAreaHTML(line) : '<div id="mycard">' + myCardHTML(line, 0) + '</div>');
    $('#pbody').scrollTop = 0;
    speakCue(line);
    if (sess.mode === 'type') startTyping(line);
    else turnControls();
  }

  // ---------------------------------------------------------------- practice: typing

  function typeAreaHTML(line) {
    const segs = P.segments(line.text);
    sess.type = { segs, idx: -1, errs: 0, done: false, tries: 0 };
    const html = segs.map((s, i) => {
      if (s.dir) return '<span class="dirt">' + esc(s.s) + '</span>';
      if (s.punct) return '<span>' + esc(s.s) + '</span>';
      return '<span class="w hid" id="tw' + i + '"><span class="b" style="width:' + ((s.lead.length + 1 + s.mid.length) * 0.5).toFixed(2) + 'em"></span>' + esc(s.trail) + '</span>';
    }).join(' ');
    return '<div class="mycard typearea" data-act="focusTyper"><div class="who">' + esc(line.speaker) + '</div><div class="txt">' + html +
      '</div><div class="typehint" id="typehint">Type the first letter of each word.</div>' +
      '<input class="typer" id="typer" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Type the first letter of each word"></div>';
  }

  function startTyping() {
    advanceWord();
    controls([
      { label: 'Show word', act: 'typeShow' },
      { label: 'Give up', act: 'typeGiveUp' }
    ]);
    const t = $('#typer');
    t.addEventListener('input', () => {
      const v = t.value;
      t.value = '';
      for (const ch of v) if (/[A-Za-z0-9]/.test(ch)) typeChar(ch);
    });
    t.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); stopPractice(true); }
      else if (e.key === 'Enter' && sess && sess.type && sess.type.done) { e.preventDefault(); typeContinue(); }
    });
    setTimeout(() => t.focus(), 50);
  }

  function advanceWord() {
    const ty = sess.type;
    do { ty.idx++; } while (ty.idx < ty.segs.length && !ty.segs[ty.idx].first);
    ty.tries = 0;
    $$('.typearea .w.cur').forEach(n => n.classList.remove('cur'));
    if (ty.idx >= ty.segs.length) { finishTyping(); return; }
    const el = $('#tw' + ty.idx);
    if (el) { el.classList.add('cur'); el.scrollIntoView({ block: 'nearest' }); }
  }

  function showWord(cls) {
    const ty = sess.type;
    const s = ty.segs[ty.idx];
    const el = $('#tw' + ty.idx);
    if (el) { el.className = 'w ' + cls; el.textContent = s.s; }
  }

  function typeChar(ch) {
    const ty = sess && sess.type;
    if (!ty || ty.done || ty.idx >= ty.segs.length) return;
    const s = ty.segs[ty.idx];
    if (ch.toLowerCase() === s.first.toLowerCase()) {
      showWord(ty.tries ? 'fix' : 'ok');
      advanceWord();
    } else {
      ty.tries++;
      if (ty.tries === 1) ty.errs++;
      const el = $('#tw' + ty.idx);
      if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
      if (ty.tries >= 2) { showWord('miss'); advanceWord(); }
    }
  }

  function typeShow() {
    const ty = sess && sess.type;
    if (!ty || ty.done) return;
    if (!ty.tries) ty.errs++;
    showWord('miss');
    advanceWord();
    const t = $('#typer'); if (t) t.focus();
  }

  function typeGiveUp() {
    const ty = sess && sess.type;
    if (!ty || ty.done) return;
    while (ty.idx < ty.segs.length) { if (!ty.tries) ty.errs++; showWord('miss'); advanceWord(); }
  }

  function finishTyping() {
    const ty = sess.type;
    ty.done = true;
    const total = ty.segs.filter(s => s.first).length;
    const okWords = total - ty.errs;
    const acc = total ? okWords / total : 1;
    ty.grade = ty.errs === 0 ? 2 : (acc >= 0.85 ? 1 : 0);
    const label = ['Missed', 'Shaky', 'Got it'][ty.grade];
    $('#typehint').innerHTML = '<b>' + label + '</b> — ' + okWords + ' of ' + plural(total, 'word') + ' right first time.';
    $('.typearea').classList.add('g-' + ty.grade);
    controls([{ label: 'Next ▸', act: 'typeNext', key: 'Enter', cls: 'primary' }]);
    if (S.settings.speakMine && TTS.ok) TTS.say(sess.cur.line.spoken, '__me');
  }

  function typeContinue() {
    if (!sess || !sess.type || !sess.type.done) return;
    sess.cur.level = 2;
    grade(sess.type.grade);
  }

  // ---------------------------------------------------------------- practice: summary

  function summary() {
    if (!sess) return;
    TTS.cancel();
    sess.gen++;
    const res = [...sess.results];
    const n = [0, 0, 0];
    for (const [, g] of res) n[g]++;
    const misses = res.filter(([, g]) => g < 2).map(([k]) => D.practice.byKey.get(k)).filter(Boolean);
    const msg = !res.length ? 'Session ended.' : n[2] === res.length ? 'Word-perfect!' : n[2] >= res.length * 0.7 ? 'Nice work!' : 'Good practice.';
    $('#feed').innerHTML = `
      <div class="done">
        <h2>${msg}</h2>
        <div class="tally"><div class="t2"><b>${n[2]}</b>got it</div><div class="t1"><b>${n[1]}</b>shaky</div><div class="t0"><b>${n[0]}</b>missed</div></div>
        ${misses.length ? '<h3>Lines to work on</h3>' + misses.map(l =>
          '<div class="review"><div class="who">' + (l.cue ? 'AFTER ' + esc(l.cue.mine ? 'YOUR LINE' : l.cue.speaker) + ': “' + esc(tail(P.spoken(l.cue.text), 6)) + '”' : 'START OF SECTION') +
          (l.page != null ? ' · p. ' + l.page : '') + '</div>' + lineHTML(l.text) + '</div>').join('') : ''}
      </div>`;
    $('#pbody').scrollTop = 0;
    sess.misses = misses.map(l => l.key);
    sess.done = true;
    const pb = $('#pauseBtn'); if (pb) pb.hidden = true;
    controls(misses.length
      ? [{ label: 'Done', act: 'close' }, { label: 'Drill these ' + misses.length, act: 'drillMisses', cls: 'primary' }]
      : [{ label: 'Done', act: 'close', cls: 'primary', key: 'Space' }]);
  }

  // ---------------------------------------------------------------- backup

  function exportBackup() {
    const data = { app: 'line-runner', version: 1, exported: new Date().toISOString(), script: S.script, me: S.me, settings: S.settings, progress: S.progress };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'line-runner-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function importBackup(file) {
    const r = new FileReader();
    r.onload = () => {
      let d;
      try { d = JSON.parse(r.result); } catch (e) { toast('That file isn’t a Line Runner backup.'); return; }
      if (!d || d.app !== 'line-runner' || typeof d.script !== 'string') { toast('That file isn’t a Line Runner backup.'); return; }
      if (S.script && !confirm('Replace the script on this device with the one in the backup? Progress from both is kept.')) return;
      S.script = d.script;
      S.me = d.me || S.me;
      S.demo = false;
      S.settings = Object.assign({}, DEFAULT_SETTINGS, S.settings, d.settings || {});
      // Keep whichever progress record for each line is more recent.
      for (const [k, p] of Object.entries(d.progress || {})) {
        if (!S.progress[k] || (p.t || 0) > (S.progress[k].t || 0)) S.progress[k] = p;
      }
      save(); askPersist(); derive(); render();
      toast('Backup restored.');
    };
    r.readAsText(file);
  }

  async function copyScript() {
    try { await navigator.clipboard.writeText(S.script); toast('Script copied. Paste it into Add pages on your other device.', 3500); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = S.script; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Script copied.'); } catch (e2) { toast('Couldn’t copy. Use Download backup instead.'); }
      ta.remove();
    }
  }

  // ---------------------------------------------------------------- events

  const ICON = {
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>'
  };

  const actions = {
    demo() { S.script = P.clean(DEMO); S.me = 'WREN'; S.demo = true; S.progress = {}; save(); derive(); render(); },
    clearDemo() { S.script = ''; S.me = ''; S.demo = false; S.progress = {}; S.undo = null; save(); derive(); render(); },
    closeTip() { S.tipClosed = true; save(); render(true); },
    quick() {
      startPractice({ mode: 'cards', title: 'Weakest lines', keys: D.practice.lines.map(l => l.key), order: 'weak', size: Number(S.settings.sessionSize) || 20 });
    },
    pickAll() { openSheet(D.practice.chunks.map((c, i) => c.keys.length ? i : -1).filter(i => i >= 0), 'Whole script'); },
    pick(el) { const i = Number(el.dataset.chunk); openSheet([i], D.practice.chunks[i].title); },
    closeSheet,
    go(el) {
      const sheet = $('#sheet');
      const chunks = sheet.dataset.chunks.split(',').map(Number);
      const mode = el.dataset.mode;
      const order = $('#ordSel') ? $('#ordSel').value : 'order';
      startPractice({ mode, chunks, order, title: sheet.dataset.title });
    },
    stop() { stopPractice(true); },
    close() { closePractice(); },
    skip,
    togglePause,
    hint,
    reveal,
    grade(el) { grade(Number(el.dataset.v)); },
    replay() { if (sess && sess.cur) { TTS.cancel(); speakCue(sess.cur.line); } },
    fullCue() { if (sess && sess.cur && sess.cur.line.cue) { $('#cueTxt').innerHTML = lineHTML(sess.cur.line.cue.text); $('.cuebox .more').remove(); } },
    revealCue(el) { el.outerHTML = esc(el.dataset.text); },
    focusTyper() { const t = $('#typer'); if (t) t.focus(); },
    typeShow, typeGiveUp,
    typeNext: typeContinue,
    drillMisses() {
      const keys = sess.misses;
      const title = sess.title;
      closePractice();
      startPractice({ mode: 'cards', keys, order: 'order', title: title + ' · misses' });
    },
    add: addPages,
    undo: undoAdd,
    edit: editScript,
    cancelEdit() { render(true); },
    saveEdit,
    showBlock(el) { showBlock(el.dataset.pos); },
    removeSection(el) {
      const si = Number(el.dataset.si);
      const scene = D.parsed && D.parsed.scenes[si];
      if (!scene) return;
      const name = scene.title || 'the part before the first heading';
      if (!confirm('Remove ' + name + ' (' + plural(Number(el.dataset.n), 'line') + ')? You can undo this.')) return;
      S.undo = S.script;
      const kept = { scenes: D.parsed.scenes.filter((s, i) => i !== si) };
      S.script = P.serialize(kept);
      S.lastDropped = [];
      save(); derive(); render(true);
      toast('Section removed.');
    },
    testVoice(el) { TTS.unlock(); TTS.cancel(); TTS.say('Good morning. This is how I sound.', el.dataset.name); },
    copyScript,
    exportBackup,
    resetProgress() { if (confirm('Reset all progress? Your script stays.')) { S.progress = {}; save(); render(true); toast('Progress reset.'); } },
    eraseAll() {
      if (!confirm('Erase your script, progress and settings from this device?')) return;
      try { localStorage.removeItem(KEY); } catch (e) {}
      S = load(); derive(); location.hash = '#/home'; render(); toast('Everything erased.');
    }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.classList.contains('sheet-bg') && e.target !== el) return;
    e.preventDefault();
    TTS.unlock();
    fn(el, e);
  });

  const changes = {
    me(v) { S.me = v; save(); derive(); render(true); },
    offBook(v) { S.settings.offBook = v; save(); renderChip(); },
    rate(v, el) { S.settings.rate = Number(v); save(); const o = $('#rateOut'); if (o) o.textContent = Number(v).toFixed(1) + '×'; },
    sessionSize(v) { S.settings.sessionSize = Math.max(5, Math.min(100, Number(v) || 20)); save(); },
    ignore(v) { S.settings.ignore = v; S.script = P.clean(S.script, { ignore: v }); save(); derive(); },
    importBackup(v, el) { if (el.files && el.files[0]) importBackup(el.files[0]); el.value = ''; }
  };

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.voice !== undefined) {
      S.settings.voiceMap[el.dataset.voice] = el.value;
      if (!el.value) delete S.settings.voiceMap[el.dataset.voice];
      save();
      return;
    }
    const k = el.dataset.change;
    if (!k) return;
    if (changes[k]) { changes[k](el.value, el); return; }
    if (el.type === 'checkbox') {
      S.settings[k] = el.checked;
      save();
      if (k === 'includeGroup') derive();
    }
  });

  document.addEventListener('input', e => {
    if (e.target.dataset.change === 'rate') changes.rate(e.target.value, e.target);
  });

  document.addEventListener('keydown', e => {
    if (!sess) {
      if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
      return;
    }
    if (e.target && e.target.id === 'typer') return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (sess.done) { if (k === ' ' || k === 'enter' || k === 'escape') { e.preventDefault(); closePractice(); } return; }
    if (k === 'escape') { e.preventDefault(); stopPractice(true); return; }
    if (sess.mode === 'type') {
      // Focus wandered off the hidden input; keep typing anyway.
      if (k.length === 1 && /[a-z0-9]/.test(k)) { e.preventDefault(); typeChar(k); }
      else if (k === 'enter') { e.preventDefault(); typeContinue(); }
      return;
    }
    if (sess.cur) {
      if (k === ' ' || k === 'enter') { e.preventDefault(); if (sess.cur.level < 2) reveal(); return; }
      if (k === 'h') { e.preventDefault(); hint(); return; }
      if (k === 'r') { e.preventDefault(); actions.replay(); return; }
      if (['1', '2', '3'].includes(k)) { e.preventDefault(); grade(Number(k) - 1); return; }
    } else if (!sess.cur && (sess.mode === 'run' || sess.mode === 'cues')) {
      if (k === ' ' || k === 'enter') { e.preventDefault(); if (sess.paused) togglePause(); else skip(); }
    }
  });

  // Chrome loads its voices a moment after the page; refresh the voice pickers when they arrive.
  document.addEventListener('lr-voices', () => {
    const a = document.activeElement;
    if (route() === 'settings' && !sess && !(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName))) render(true);
  });

  // The other tab may have changed the data (e.g. a restore); pick it up.
  window.addEventListener('storage', e => {
    if (e.key === KEY && !sess) { S = load(); derive(); render(true); }
  });

  if (S.settings.theme) document.documentElement.dataset.theme = S.settings.theme;

  derive();
  render();
  if (!location.hash) history.replaceState(null, '', '#/home');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}());
