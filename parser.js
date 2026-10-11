/* Line Runner — script parser.
 *
 * Turns text copied from photos of a printed play (iPhone Live Text, Google Lens…)
 * into a clean script, and turns that clean script into practice material.
 *
 *   clean(raw)          messy pasted text      -> canonical text
 *   parse(text)         raw or canonical text  -> { scenes, cast, warnings }
 *   buildPractice(...)  parsed script          -> the lines one character must learn, with cues
 *
 * Canonical format, one block per line (parse() also reads this, so clean() is idempotent):
 *   # Act One, Scene 2              scene heading
 *   (She crosses to the window.)    stage direction
 *   MARY: (crossly) I won't.        speech; anything in ( ) is a direction, not spoken
 *
 * Runs in the browser (window.LineParser) and in Node (require) for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LineParser = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- patterns -----------------------------------------------------------

  const TITLE = "(?:(?:MR|MRS|MS|MISS|DR|ST|SIR|LADY|LORD|REV|CAPT|SGT)\\.?\\s+)?";
  const WORD = "[A-Z][A-Z0-9'\\u2019\\-]*";
  const NAME = TITLE + WORD + "(?:\\s+(?:&|AND|" + WORD + ")){0,3}";
  const RE_INLINE = new RegExp("^(" + NAME + ")\\s*(\\([^)]*\\))?\\s*([.:;,])\\s*(.*)$");
  const RE_NAME_PAREN = new RegExp("^(" + NAME + ")\\s*(\\([^)]*\\))\\s*(.+)$");
  const RE_NAME_ONLY = new RegExp("^(" + NAME + ")\\s*(\\([^)]*\\))?\\s*[.:]?$");
  const RE_MID = new RegExp("([.!?\\u2026)\\]])\\s+(" + NAME + ")(?:\\s*\\([^)]*\\))?\\s*[.:]\\s+(?=[A-Z(\"\\u201C'\\u2018])", 'g');

  const NUMWORD = "(?:\\d{1,2}|[IVXLC]{1,6}|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|" +
    "ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN|SIXTEEN|SEVENTEEN|EIGHTEEN|NINETEEN|TWENTY)";
  const RE_HEADING = new RegExp("^(ACT|SCENE)\\s+" + NUMWORD + "\\b(.*)$", "i");
  const RE_HEADING_WORD = /^(PROLOGUE|EPILOGUE|ENTR'?ACTE)\s*[.:]?$/i;
  // "# Act Two" — but not "#1 Mary's Travels" from a music cue list.
  const RE_CANON_HEADING = /^#\s+(?!\d)(\S.*)$/;

  // All-caps words that start lines but are never characters.
  const STOP = new Set(('ACT SCENE END BLACKOUT CURTAIN INTERMISSION LIGHTS FADE MUSIC SOUND ' +
    'SETTING TIME PLACE CAST CHARACTERS PAUSE SILENCE BEAT NOTE NOTES TRANSITION PROLOGUE ' +
    'EPILOGUE NO YES OH OK OKAY AH AW EH HA HEY WELL STOP WAIT HELP WHAT WHY HOW NOW THEN ' +
    'AND BUT THE A I O II III IV V VI MR MRS MS DR ST SIR MISS LADY LORD REV').split(' '));
  STOP.add('THE END'); STOP.add('END OF PLAY'); STOP.add('END OF ACT');
  // First words that rule out a name when the name stands alone on its line.
  const STOP_FIRST = new Set('THE A AN AT IN ON OF LIGHTS FADE END CURTAIN MUSIC SOUND ACT SCENE'.split(' '));
  const GROUP = /^(ALL|BOTH|EVERYONE|CHORUS|ENSEMBLE|COMPANY|OTHERS)$/;
  const CONTD = /\(\s*(?:cont'?d|cont\.|continued|continuing)\s*\)/i;

  // ---- small helpers ------------------------------------------------------

  // Pencilled blocking marks come through the OCR as arrows: "→ L", "↳ DSR".
  const RE_ARROW = /\s*[←-⇿⟰-⟿⤀-⥿➔➜➝➡]+\s*(?:[A-Z]{1,3}\b(?![.:]))?/g;

  function normLine(s) {
    return fixNested(s.replace(/[ \t]/g, ' ').replace(RE_ARROW, ' ').replace(/\s+/g, ' ').trim());
  }

  // Directions never nest, so "(He laughs. (MUSIC IN.)" lost a ")" to the OCR: put it back.
  function fixNested(s) {
    let d = 0, out = '';
    for (const c of s) {
      if (c === '(') {
        if (d > 0) { out = out.replace(/\s+$/, '') + ') '; d--; }
        d++;
      } else if (c === ')') d = Math.max(0, d - 1);
      out += c;
    }
    return out;
  }

  // Is the punctuation at idx the period of a title — "MRS." in "MRS. MEDLOCK"?
  function afterTitle(line, idx) {
    return /(?:^|[\s(])(?:MR|MRS|MS|DR|ST|Mr|Mrs|Ms|Dr|St)$/.test(line.slice(0, idx));
  }

  // OCR of pencil notes: tokens mixing digits with letters or symbols ("00K", "5+2").
  // Scripts spell numbers out, and music cues ("[I, #7]") are left alone.
  function isGarbage(t) {
    return /\d/.test(t) && /[A-Za-z+*=]/.test(t) && !/[#\[\]]/.test(t);
  }

  function normName(s) {
    return s.toUpperCase().replace(/’/g, "'").replace(/\s+/g, ' ')
      .replace(/^(MR|MRS|MS|DR|ST)\.?\s+/, '$1. ').trim();
  }

  function letters(s) { return s.replace(/[^A-Za-z]/g, '').length; }

  function realWords(name) {
    return name.split(' ').filter(w => w !== 'AND' && w !== '&');
  }

  function parenDepth(s) {
    let d = 0;
    for (const c of s) { if (c === '(') d++; else if (c === ')') d--; }
    return d;
  }

  // Index just past the paren group that opens at the start of s, or -1 if it never closes.
  function closeIndex(s) {
    let d = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') d++;
      else if (s[i] === ')') { d--; if (d === 0) return i + 1; }
    }
    return -1;
  }

  function join(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a + ' ' + b;
  }

  function isAllCaps(s) { return letters(s) >= 3 && s === s.toUpperCase(); }

  function isTitleCase(s) {
    return s.split(/\s+/).every(w => !/[a-z]/.test(w[0] || '') );
  }

  // Text with every ( … ) and [ … ] removed — what the actor actually says.
  function spoken(text) {
    let s = text, prev;
    do { prev = s; s = s.replace(/\([^()]*\)/g, ' ').replace(/\[[^\[\]]*\]/g, ' '); } while (s !== prev);
    return s.replace(/[()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function words(text) {
    return spoken(text).split(' ').filter(w => /[A-Za-z0-9]/.test(w));
  }

  // FNV-1a, base36 — stable ids for progress tracking.
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  function headingOf(line) {
    let m = RE_CANON_HEADING.exec(line);
    if (m) return { title: m[1].trim() };
    if (RE_HEADING_WORD.test(line)) return { title: line.replace(/[.:]$/, '') };
    m = RE_HEADING.exec(line);
    if (!m) return null;
    const rest = m[2].trim();
    // Running heads: "Act I 13", "Act I THE LIGHTHOUSE KEY Page 11" (but not "Act I, Scene 2").
    if (/^\d{1,3}$/.test(rest) ||
        (/(?:^|\s)(?:page\s*)?\d{1,3}$/i.test(rest) && !/SCENE\s+\d{1,3}$/i.test(rest))) return { pageHeader: true };
    if (rest && !/^[,.:;—–\-(]/.test(rest) && !/^SCENE\b/i.test(rest) &&
        rest !== rest.toUpperCase()) return null;                        // prose: "Act two of my life…"
    if (line.length > 70) return null;
    return { title: line.replace(/[.:]$/, '') };
  }

  const ROMAN = { ONE: 'I', TWO: 'II', THREE: 'III', FOUR: 'IV', FIVE: 'V', 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };
  // "ACT ONE", "Act I", "ACT 1." -> "ACT I"; '' when the heading is not an act-only heading.
  // Copes with OCR'd numerals: "Act Ill", "Act IIl", "Act I!" (an I read as l, 1, ! or |).
  function actKey(title) {
    const m = /^ACT\s+([IVXL1!|]+|ONE|TWO|THREE|FOUR|FIVE)\s*[.:!]?$/i.exec(title.trim());
    if (!m) return '';
    let n = m[1].toUpperCase();
    if (!ROMAN[n]) n = n.replace(/[L1!|]/g, 'I');
    return 'ACT ' + (ROMAN[n] || n);
  }

  const RE_LEADER = /\.{6,}|(?:\.\s){4,}/;   // cast-list leaders: "WREN .......... 10 years old"

  // Page furniture — page numbers, running heads, rules. Returns null for real text,
  // or { page } where page is the page number the line carried (or null).
  function furniture(line, ignore) {
    let m = /^[(\[]?\s*(?:page|pg\.?|p\.)?\s*(\d{1,3})\s*[)\]]?$/i.exec(line);
    if (m) return { page: +m[1] };
    if (/^[\-–—_=*•·~.\s]+$/.test(line)) return { page: null };
    if (RE_LEADER.test(line)) return { page: null };
    const sp = RE_INLINE.exec(line);
    const isSpeech = sp && (sp[3] === '.' || sp[3] === ':') && sp[4];   // "DICKON. Number 7"
    if (!isSpeech) {
      let num = null, body = null;
      if ((m = /^(?:page\s*)?(\d{1,3})\s+(.+)$/i.exec(line))) { num = +m[1]; body = m[2]; }
      else if ((m = /^(.+?)\s+(?:page\s*)?(\d{1,3})$/i.exec(line))) { num = +m[2]; body = m[1]; }
      if (body !== null) {
        const h = headingOf(line);
        if (h && h.pageHeader) return { page: num };
        if (!(h && h.title) && body.split(/\s+/).length <= 8 && isTitleCase(body) && letters(body) >= 3) {
          return { page: num };
        }
      }
    }
    const low = line.toLowerCase();
    if (!isSpeech && ignore.some(p => low.includes(p))) return { page: null };
    return null;
  }

  // ---- parse ---------------------------------------------------------------

  // Lines of text, with page numbers pulled out as { page } markers.
  function prepLines(raw, ignore) {
    let out = [];
    const dropped = [];
    for (const l of String(raw || '').replace(/\r\n?/g, '\n').split('\n')) {
      let line = normLine(l);
      if (!line) continue;
      const f = RE_CANON_HEADING.test(line) ? null : furniture(line, ignore);
      if (f) { if (f.page !== null) out.push({ page: f.page }); continue; }
      const toks = line.split(' ');
      if (toks.length <= 3 && toks.some(isGarbage) && toks.every(t => isGarbage(t) || /^[a-z]{1,2}$/.test(t))) {
        dropped.push(line);                                   // a pencil note on its own line
        continue;
      }
      // A pencil note stuck to the end of a line, after the sentence ended: "…about him. 5+2 nd"
      const m = /^(.*[.!?)\]…—"'”’])\s+(\S+(?:\s+\S+){0,2})$/.exec(line);
      if (m && m[2].split(' ').some(isGarbage) && parenDepth(m[1]) === 0) {
        dropped.push(m[2]);
        line = m[1];
      }
      out.push(line);
    }
    // A word or two in lower case, alone on a line right after a sentence ended, can't be
    // printed text (that would start with a capital): it's a pencil note ("around").
    const textAt = (i, step) => {
      for (let j = i + step; j >= 0 && j < out.length; j += step) if (typeof out[j] === 'string') return out[j];
      return null;
    };
    out = out.filter((l, i) => {
      if (typeof l !== 'string' || !/^[a-z]+(?: [a-z]+)?$/.test(l)) return true;
      const prev = textAt(i, -1), next = textAt(i, 1);
      if (!prev || !/[.!?)]$/.test(prev) || /(\.\.\.|…)$/.test(prev)) return true;
      if (next && /^[a-z]/.test(next)) return true;
      dropped.push(l);
      return false;
    });
    // A capitalised line of 3+ words that keeps coming back is a running head ("THE LIGHTHOUSE
    // KEY"). Count earlier clean-ups too, where it was kept as a "(THE LIGHTHOUSE KEY)" direction.
    const seen = new Map();
    const capsHead = l => {
      if (typeof l !== 'string') return null;
      let s = l;
      if (s[0] === '(' && closeIndex(s) === s.length) s = s.slice(1, -1).trim();
      if (!isAllCaps(s) || /[!?()]/.test(s) || /\.$/.test(s)) return null;
      if (realWords(s.replace(/[^A-Z' ]/g, ' ').trim().replace(/\s+/g, ' ')).length < 3) return null;
      if ((RE_INLINE.exec(s) || [])[4]) return null;
      return s;
    };
    for (const l of out) { const k = capsHead(l); if (k) seen.set(k, (seen.get(k) || 0) + 1); }
    const learned = [...seen].filter(([, n]) => n >= 2).map(([k]) => k);
    if (learned.length) out = out.filter(l => !learned.includes(capsHead(l)));
    // Rejoin words hyphenated across a line break: "gar-" + "den" -> "garden".
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      if (typeof a === 'string' && typeof b === 'string' &&
          /[a-z]-$/.test(a) && !/--$/.test(a) && /^[a-z]/.test(b)) {
        out[i] = a.slice(0, -1) + b;
        out.splice(i + 1, 1);
        i--;
      }
    }
    return { lines: out, learned, dropped };
  }

  // Live Text sometimes runs two short speeches into one line:
  //   "BOY. Is! (MUSIC IN.) MARY. Isn't!"
  // Split before a known speaker that follows the end of a sentence, outside any ( … ).
  function splitMerged(lines, cast) {
    const names = [...cast.strong].sort((a, b) => b.length - a.length);
    if (!names.length) return lines;
    const alt = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/^(MR|MRS|MS|DR|ST)\\\. /, '$1\\.?\\s+').replace(/ /g, '\\s+')).join('|');
    const re = new RegExp('([.!?…)\\]])\\s+(?=(?:' + alt + ')(?:\\s*\\([^)]*\\))?\\s*[.:]\\s+\\S)', 'g');
    const out = [];
    let depth = 0;
    for (const line of lines) {
      if (typeof line !== 'string') { out.push(line); continue; }
      if (depth > 0) {
        const v = RE_INLINE.exec(line);
        if (v && (v[3] === '.' || v[3] === ':') && v[4] && !line.includes(')') && cast.strong.has(normName(v[1]))) depth = 0;
      }
      const parts = [];
      let start = 0, m;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        const cut = m.index + m[1].length;
        if (!afterTitle(line, m.index) && depth + parenDepth(line.slice(0, cut)) <= 0) {
          parts.push(line.slice(start, cut).trim());
          start = cut;
        }
      }
      parts.push(line.slice(start).trim());
      for (const p of parts) if (p) out.push(p);
      depth = Math.max(0, depth + parenDepth(line));
    }
    return out;
  }

  function findCast(lines) {
    const counts = new Map();
    const bump = (name, kind) => {
      const c = counts.get(name) || { strong: 0, only: 0 };
      c[kind]++;
      counts.set(name, c);
    };
    let depth = 0;
    for (const line of lines) {
      if (typeof line !== 'string') continue;
      if (depth > 0) {
        // Same safety valve as parse(): a punctuated speaker line ends a runaway "(".
        const v = RE_INLINE.exec(line);
        const valve = v && (v[3] === '.' || v[3] === ':') && v[4] && !line.includes(')') &&
          !STOP.has(normName(v[1]));
        if (!valve) { depth = Math.max(0, depth + parenDepth(line)); continue; }
        depth = 0;
      }
      // A speaker the OCR ran into the middle of a line: "…(KEEPER exits.) MRS. HOLLOWAY. I…"
      RE_MID.lastIndex = 0;
      let mm;
      while ((mm = RE_MID.exec(line))) {
        const name = normName(mm[2]);
        if (!afterTitle(line, mm.index) && parenDepth(line.slice(0, mm.index + mm[1].length)) === 0 && !STOP.has(name) &&
            !STOP_FIRST.has(realWords(name)[0]) && letters(name) >= 2) bump(name, 'strong');
      }
      if (line[0] === '(' || line[0] === '[') { depth = Math.max(0, parenDepth(line)); continue; }
      if (headingOf(line)) continue;
      let m = RE_INLINE.exec(line);
      if (m && (m[3] === '.' || m[3] === ':')) {
        bump(normName(m[1]), m[4] || m[2] ? 'strong' : 'only');
        continue;
      }
      m = RE_NAME_PAREN.exec(line);
      if (m) { bump(normName(m[1]), 'strong'); continue; }
      m = RE_NAME_ONLY.exec(line);
      if (m) bump(normName(m[1]), 'only');
    }
    const names = new Set();
    const strong = new Set();
    for (const [name, c] of counts) {
      if (STOP.has(name) || letters(name) < 2) continue;
      const rw = realWords(name);
      if (rw.length > 3) continue;
      if (c.strong > 0) { names.add(name); strong.add(name); continue; }
      if (rw.length <= 2 && !STOP_FIRST.has(rw[0])) names.add(name);
    }
    const byLength = [...names].sort((a, b) => b.length - a.length);
    return { names, strong, byLength };
  }

  function matchSpeaker(line, cast) {
    let m = RE_INLINE.exec(line);
    if (m) {
      const name = normName(m[1]);
      if (cast.names.has(name) && (m[3] === '.' || m[3] === ':' || cast.strong.has(name))) {
        return { name, text: join(m[2] || '', m[4]), explicit: true };
      }
    }
    m = RE_NAME_PAREN.exec(line);
    if (m && cast.names.has(normName(m[1]))) return { name: normName(m[1]), text: join(m[2], m[3]), explicit: true };
    m = RE_NAME_ONLY.exec(line);
    if (m && cast.names.has(normName(m[1]))) return { name: normName(m[1]), text: m[2] || '', explicit: true };
    // A known name that lost its period to the OCR: "MARY I won't."
    const upper = line.replace(/’/g, "'");
    for (const n of cast.byLength) {
      if (!cast.strong.has(n)) continue;
      if (upper.startsWith(n) && upper.length > n.length && /^[\s(.:;,]/.test(upper.slice(n.length))) {
        const rest = line.slice(n.length).replace(/^\s*[.:;,]?\s*/, '');
        if (rest) return { name: n, text: rest };
      }
    }
    return null;
  }

  function parse(text, opts) {
    opts = opts || {};
    const ignore = String(opts.ignore || '').split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const prep = prepLines(text, ignore);
    const lines = splitMerged(prep.lines, findCast(prep.lines));
    const cast = findCast(lines);
    const warnings = [];
    const blocks = [];       // flat: {type:'scene'|'speech'|'direction', page}
    let recv = null;         // block still inside an unclosed ( … )
    let depth = 0;
    let page = null;         // printed page number, from the running heads
    let lastAct = '';

    const last = () => blocks[blocks.length - 1];
    const push = b => { if (b.type !== 'scene') b.page = page; blocks.push(b); return b; };
    // The speech a continuation line belongs to, if the scene has one.
    const lastSpeechInScene = () => {
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].type === 'scene') return null;
        if (blocks[i].type === 'speech') return blocks[i];
      }
      return null;
    };

    function append(block, line) {
      block.text = join(block.text, line);
      depth = Math.max(0, parenDepth(block.text));
      recv = depth > 0 ? block : null;
    }

    function continuation(line) {
      const b = last();
      if (b && b.type === 'speech') { append(b, line); return; }
      if (b && b.type === 'direction') {
        const prev = blocks[blocks.length - 2];
        if (prev && prev.type === 'speech') {
          // Speech interrupted by a direction, then more speech: fold the direction in.
          blocks.pop();
          prev.text = join(prev.text, wrapDirection(b.text));
          append(prev, line);
          return;
        }
      }
      push({ type: 'direction', text: '' });
      append(last(), line);
    }

    // Is line li part of a page's running head — next to a page number (perhaps with the
    // play's title line in between)?
    const nearPage = li => {
      for (const step of [-1, 1]) {
        for (let k = 1; k <= 2; k++) {
          const x = lines[li + step * k];
          if (x === undefined) break;
          if (typeof x !== 'string') return true;
          if (!(isAllCaps(x) && !/[.!?]$/.test(x))) break;     // only a title line may sit between
        }
      }
      return false;
    };

    for (let li = 0; li < lines.length; li++) {
      let line = lines[li];
      if (typeof line !== 'string') { page = line.page; continue; }
      if (recv) {
        // Directions don't nest: a "(" while one is still open means the OCR lost a ")".
        const oi = line.indexOf('('), ci = line.indexOf(')');
        if (oi === 0) { recv.text += ')'; recv = null; depth = 0; }
        else if (oi > 0 && (ci < 0 || oi < ci)) line = line.slice(0, oi).trimEnd() + ') ' + line.slice(oi);
      }
      if (recv) {
        // Safety valve: a missing ")" must not swallow the rest of the play. Only a
        // properly punctuated speaker line counts — directions often start "MARY kneels…".
        const sp = matchSpeaker(line, cast);
        if (sp && sp.explicit && cast.strong.has(sp.name) && !line.includes(')')) {
          recv.text += ')';
          warnings.push({ kind: 'unclosed', text: recv.text.slice(0, 60) });
          recv = null; depth = 0;
        } else {
          const before = recv;
          append(recv, line);
          if (!recv && before.type === 'direction') {
            const ci = closeIndex(before.text);
            const after = ci > 0 ? before.text.slice(ci).trim() : '';
            if (after && /[A-Za-z]/.test(after)) {
              // "(She crosses … looks out.) I can't see it." — the tail is speech.
              before.text = before.text.slice(0, ci);
              blocks.pop();
              const sp2 = lastSpeechInScene();
              if (sp2 && blocks[blocks.length - 1] === sp2) {
                sp2.text = join(sp2.text, before.text);
                append(sp2, after);
              } else {
                blocks.push(before);
                continuation(after);
              }
            }
          }
          continue;
        }
      }

      const h = headingOf(line);
      if (h) {
        if (h.title) {
          // The act name repeats in every page's running head ("Act I", "Act I THE LIGHTHOUSE
          // KEY"); only the first one is a heading. "Act I, Scene 2" is still new.
          const m = /^(ACT\s+[A-Z0-9!|]+)[.,:;]?\s*(.*)$/i.exec(h.title);
          if (m) {
            const act = actKey(m[1]);
            const rest = m[2].replace(/^[,—–\-:;.\s]+/, '');
            if (act === lastAct && !/^SCENE\b/i.test(rest)) continue;
            // A bare "Act II" beside a page number is a running head, even when the OCR misreads
            // its numeral and it no longer matches the act we're in. Real act headings are set
            // in capitals ("ACT II") or spelled out ("Act Two"); the first act heading is trusted.
            if (act && lastAct && !RE_CANON_HEADING.test(line) && nearPage(li) &&
                h.title !== h.title.toUpperCase() && !/^ACT\s+(ONE|TWO|THREE|FOUR|FIVE)\b/i.test(h.title)) continue;
            lastAct = act || actKey(m[1].replace(/[.,:;!|]+$/, ''));
          }
          blocks.push({ type: 'scene', title: h.title });
        }
        continue;
      }

      const sp = matchSpeaker(line, cast);
      if (sp) {
        const prevSpeech = lastSpeechInScene();
        if (CONTD.test(sp.text) && prevSpeech && prevSpeech.speaker === sp.name) {
          // "MARY (cont'd)" at the top of a new page.
          const rest = sp.text.replace(CONTD, '').trim();
          const b = last();
          if (b !== prevSpeech && b.type === 'direction') {
            blocks.pop();
            prevSpeech.text = join(prevSpeech.text, wrapDirection(b.text));
          }
          if (rest) append(prevSpeech, rest);
          continue;
        }
        const block = push({ type: 'speech', speaker: sp.name, text: '' });
        if (sp.text) append(block, sp.text);
        continue;
      }

      if (line[0] === '(' || line[0] === '[') {
        const cur = last() && last().type === 'speech' ? last() : null;
        const ci = closeIndex(line);
        if (ci < 0) {
          if (cur && !cur.text) { append(cur, line); continue; }
          push({ type: 'direction', text: '' });
          append(last(), line);
          continue;
        }
        const after = line.slice(ci).trim();
        const standalone = !after || /^[.,;:!?]*$/.test(after);
        if (cur && (!cur.text || !standalone)) { append(cur, line); continue; }
        if (!cur && !standalone && lastSpeechInScene() && last().type === 'direction') {
          continuation(line);
          continue;
        }
        push({ type: 'direction', text: line });
        continue;
      }

      if (isAllCaps(line) && !/[!?]/.test(line)) {
        // A capitalised line that isn't a name: a running head or a caps stage direction.
        // (Shouted dialogue — "I HATE IT!" — keeps its ! or ? and stays dialogue.)
        push({ type: 'direction', text: line, caps: true });
        continue;
      }

      continuation(line);
    }
    if (recv) {
      recv.text += ')';
      warnings.push({ kind: 'unclosed', text: recv.text.slice(0, 60) });
    }

    // Group into scenes; a heading with nothing under it joins the next one ("ACT ONE" + "SCENE 1").
    const scenes = [];
    let scene = null;
    let pendingTitle = '';
    for (const b of blocks) {
      if (b.type === 'scene') {
        if (scene && scene.blocks.length === 0) {
          pendingTitle = join(scene.title, '— ' + b.title).replace(/^— /, '');
          scenes.pop();
        } else {
          pendingTitle = b.title;
        }
        scene = { title: pendingTitle, blocks: [] };
        scenes.push(scene);
        continue;
      }
      if (!scene) { scene = { title: '', blocks: [] }; scenes.push(scene); }
      if (b.type === 'speech') b.text = b.text.trim();
      scene.blocks.push(b);
    }
    // Merge an empty trailing heading-only scene into nothing.
    const kept = scenes.filter((s, i) => s.blocks.length || i === scenes.length - 1 && s.title);

    const counts = new Map();
    for (const s of kept) for (const b of s.blocks) {
      if (b.type === 'speech') counts.set(b.speaker, (counts.get(b.speaker) || 0) + 1);
    }
    const castList = [...counts].map(([name, lines]) => ({ name, lines })).sort((a, b) => b.lines - a.lines);
    for (const c of castList) {
      if (c.lines === 1) warnings.push({ kind: 'single', name: c.name });
    }
    return { scenes: kept, cast: castList, warnings, learned: prep.learned, dropped: prep.dropped };
  }

  // One pair of parentheses around a direction. Inner ones are dropped rather than nested,
  // so the result reads back the same way.
  function wrapDirection(text) {
    const t = text.trim();
    if (t[0] === '(' && t[t.length - 1] === ')' && closeIndex(t) === t.length && parenDepth(t.slice(1, -1)) === 0 &&
        !/[()]/.test(t.slice(1, -1))) return t;
    return '(' + t.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim() + ')';
  }

  function serialize(parsed) {
    const out = [];
    let page = null;
    parsed.scenes.forEach((s, i) => {
      if (i > 0) out.push('');
      if (s.title) out.push('# ' + s.title);
      for (const b of s.blocks) {
        if (b.page != null && b.page !== page) { out.push('Page ' + b.page); page = b.page; }
        if (b.type === 'direction') out.push(wrapDirection(b.text));
        else out.push(b.speaker + ': ' + b.text);
      }
    });
    return out.join('\n') + (out.length ? '\n' : '');
  }

  function clean(text, opts) { return serialize(parse(text, opts)); }

  // ---- practice ------------------------------------------------------------

  function isMine(speaker, me, includeGroup) {
    if (!me) return false;
    if (speaker === me) return true;
    const parts = speaker.split(/\s*(?:&|\bAND\b|,|\/)\s*/);
    if (parts.includes(me)) return true;
    return !!includeGroup && GROUP.test(speaker);
  }

  // Scenes longer than this many blocks (~3–4 printed pages) are split into practice sections.
  const CHUNK = 45;
  const RE_SCENE_CHANGE = /scene change|lights? (?:fade|out|down|up|rise|come up|change|shift)|blackout|curtain|transition|time passes|later that|next morning|the next day/i;

  // Section boundaries for one scene: prefer a scene-change direction near each cut,
  // then any direction, then a hard cut.
  function sections(blocks) {
    const n = blocks.length;
    if (n <= CHUNK * 1.4) return [[0, n]];
    const parts = [];
    let start = 0;
    while (start < n) {
      let end = Math.min(n, start + CHUNK);
      if (n - end < CHUNK * 0.4) end = n;
      if (end < n) {
        const lo = start + Math.floor(CHUNK * 0.5), hi = Math.min(n - 1, start + Math.floor(CHUNK * 1.5));
        let best = -1;
        for (let j = lo; j <= hi; j++) {
          if (blocks[j].type === 'direction' && RE_SCENE_CHANGE.test(blocks[j].text) &&
              (best < 0 || Math.abs(j - (start + CHUNK)) < Math.abs(best - (start + CHUNK)))) best = j + 1;
        }
        if (best < 0) {
          for (let j = end; j > start + CHUNK * 0.6; j--) {
            if (blocks[j].type === 'direction') { best = j; break; }
          }
        }
        if (best > start) end = best;
        if (n - end < CHUNK * 0.4) end = n;
      }
      parts.push([start, end]);
      start = end;
    }
    return parts;
  }

  function pageRange(blocks, from, to) {
    let a = null, b = null;
    for (let i = from; i < to; i++) {
      const p = blocks[i].page;
      if (p == null) continue;
      if (a === null) a = p;
      b = p;
    }
    if (a === null) return '';
    return a === b ? 'p. ' + a : 'pp. ' + a + '–' + b;
  }

  // "ACT TWO — SCENE THREE" -> "Act Two — Scene Three"; Roman numerals stay capitals.
  function titleCase(s) {
    if (s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (w, a, b) =>
      /^[ivxl]+$/.test(w) ? w.toUpperCase() : a.toUpperCase() + b);
  }

  function buildPractice(parsed, me, opts) {
    opts = opts || {};
    const lines = [];
    const chunks = [];
    const seen = new Map();
    if (!parsed) return { lines, chunks, byKey: new Map() };

    let act = '';
    parsed.scenes.forEach((scene, si) => {
      const parts = sections(scene.blocks);
      // Scene titles repeat in every act, so name sections "Act Two · Scene Three".
      let label = scene.title ? titleCase(scene.title) : '';
      if (/^act\b/i.test(label)) act = label.split(/\s+[—–-]\s+/)[0];
      else if (/^scene\b/i.test(label) && act) label = act + ' · ' + label;
      parts.forEach(([from, to], pi) => {
        const base = label || (parsed.scenes.length > 1 && si === 0 ? 'Opening' : 'Script');
        const pages = pageRange(scene.blocks, from, to);
        const title = parts.length > 1 ? base + ' · ' + (pages || 'Part ' + (pi + 1)) : base;
        const chunk = { title, pages, scene: si, from, to, keys: [] };
        for (let bi = from; bi < to; bi++) {
          const b = scene.blocks[bi];
          if (b.type !== 'speech' || !isMine(b.speaker, me, opts.includeGroup)) continue;
          const said = spoken(b.text);
          if (!/[A-Za-z0-9]/.test(said)) continue;
          const base = b.speaker + '|' + said.toLowerCase().replace(/[^a-z0-9 ]/g, '');
          const n = (seen.get(base) || 0) + 1;
          seen.set(base, n);
          const key = hash(base + '#' + n);
          let cue = null;
          for (let k = bi - 1; k >= 0; k--) {
            const c = scene.blocks[k];
            if (c.type === 'speech' && /[A-Za-z0-9]/.test(spoken(c.text))) {
              cue = { speaker: c.speaker, text: c.text, mine: isMine(c.speaker, me, opts.includeGroup) };
              break;
            }
          }
          let context = null;
          if (!cue) {
            for (let k = bi - 1; k >= 0; k--) {
              if (scene.blocks[k].type === 'direction') { context = scene.blocks[k].text; break; }
            }
          }
          const line = {
            key, scene: si, block: bi, chunk: chunks.length, speaker: b.speaker, page: b.page,
            text: b.text, spoken: said, words: words(b.text).length, cue, context
          };
          lines.push(line);
          chunk.keys.push(key);
        }
        chunks.push(chunk);
      });
    });
    return { lines, chunks, byKey: new Map(lines.map(l => [l.key, l])) };
  }

  // Checks on one character's lines that usually mean the cleanup glued something on.
  const RE_DIRECTIONISH = /\b(enters|exits|exeunt|crosses (?:to|up|down|over)|lights (?:up|down|fade|change|rise|shift)|blackout|sound of|music (?:plays|begins|swells)|(?:she|he|they) (?:turns|crosses|sits|stands|runs|exits|enters|looks|goes)\b)/i;

  function lineWarnings(parsed, me, opts) {
    const out = [];
    if (!parsed || !me) return out;
    const castNames = new Set();
    for (const c of parsed.cast) for (const w of realWords(c.name)) if (w.length > 2) castNames.add(w);
    parsed.scenes.forEach((scene, si) => scene.blocks.forEach((b, bi) => {
      if (b.type !== 'speech' || !isMine(b.speaker, me, opts && opts.includeGroup)) return;
      const said = spoken(b.text);
      const n = words(b.text).length;
      const capsName = said.split(/\s+/).map(w => w.replace(/[^A-Za-z']/g, ''))
        .find(w => w.length > 2 && w === w.toUpperCase() && castNames.has(w));
      if (capsName) out.push({ scene: si, block: bi, msg: capsName + ' in capitals inside your line — a stage direction or another character’s line may be stuck to it.' });
      else if (RE_DIRECTIONISH.test(said)) out.push({ scene: si, block: bi, msg: 'Sounds like a stage direction inside your line. If it is, put ( ) around it.' });
      else if (/\((?:[^)]*\b(?:enters|enter)\b[^)]*)\)\s*\S/i.test(b.text)) out.push({ scene: si, block: bi, msg: 'Someone enters in the middle of your line — check that the next character’s name didn’t get lost.' });
      else if (n > 120) out.push({ scene: si, block: bi, msg: 'Long speech (' + n + ' words). Worth checking it’s all yours.' });
    }));
    return out;
  }

  // ---- display helpers -----------------------------------------------------

  // Split a line into words and ( … ) directions, for hint and typing modes.
  function segments(text) {
    const out = [];
    let i = 0;
    const s = text || '';
    while (i < s.length) {
      if (s[i] === ' ') { i++; continue; }
      if (s[i] === '(' || s[i] === '[') {
        const open = s[i], close = open === '(' ? ')' : ']';
        let d = 0, j = i;
        for (; j < s.length; j++) {
          if (s[j] === open) d++;
          else if (s[j] === close) { d--; if (d === 0) { j++; break; } }
        }
        out.push({ dir: true, s: s.slice(i, j) });
        i = j;
        continue;
      }
      let j = i;
      while (j < s.length && s[j] !== ' ' && s[j] !== '(' && s[j] !== '[') {
        // "won't—not": a dash between words ends the first one.
        if ((s[j] === '—' || s[j] === '–') && j > i && /[A-Za-z0-9]/.test(s[j + 1] || '')) { j++; break; }
        j++;
      }
      const w = s.slice(i, j);
      const m = /^([^A-Za-z0-9]*)([A-Za-z0-9])(.*?)([^A-Za-z0-9]*)$/.exec(w);
      if (m) out.push({ s: w, lead: m[1], first: m[2], mid: m[3], trail: m[4] });
      else out.push({ s: w, punct: true });
      i = j;
    }
    return out;
  }

  return {
    clean, parse, serialize, buildPractice, lineWarnings, isMine,
    spoken, words, segments, hash, wrapDirection
  };
}));
