// Parser tests. Run from app/: node --test test
// Fixtures are original made-up dialogue (never real script text), shaped like
// what iPhone Live Text produces from a photographed page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../parser.js');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const speeches = parsed => parsed.scenes.flatMap(s => s.blocks.filter(b => b.type === 'speech'));

test('messy inline-format page cleans up', () => {
  const out = P.clean(fixture('inline-messy.txt'));
  const lines = out.trim().split('\n');
  assert.equal(lines[0], '# ACT ONE — Scene 1');
  assert.equal(lines[1], 'Page 12', 'page number kept from the running head');
  assert.match(lines[2], /^\(Lights rise on a rocky shore\. WREN sits on an upturned boat, scowling at the sea\.\)$/);
  assert.ok(lines.includes('Page 13') && lines.includes('Page 14') && lines.includes('Page 15'));
  assert.ok(lines.includes("KEEPER: You'll catch your death sitting out here, miss."));
  assert.ok(lines.includes('KEEPER: (gently) Nobody asks the tide, either. Still it comes.'));
  assert.ok(lines.includes("WREN: That's a stupid thing to say. (She turns away.) Everything here is grey."));
  assert.ok(lines.includes('MRS. HOLLOWAY: Hungry or not, you\'ll sit.'), 'MRS HOLLOWAY normalised');
  assert.ok(lines.includes("WREN AND OTIS: We won't!"));
  assert.ok(lines.includes('ALL: Hush!'));
  assert.ok(lines.includes('KEEPER: Nobody, these ten years. The key was lost the winter Mr. Ashby— (He stops himself.) Well. It was lost.'),
    'direction folded into a speech that continues, across a page break');
  assert.ok(lines.some(l => l.endsWith("Mind the rocks; they're slippery after dark.")), 'hyphenation rejoined');
  assert.ok(lines.includes('# Scene 2'));
  assert.ok(lines.includes("OTIS: I'm Otis. I see to the lamps, and the boots, and the keeper's dinner when Mrs. Holloway's busy. (Grinning.) Which is always."),
    "(CONT'D) merged into the speech it continues");
  assert.ok(!out.includes('LIGHTHOUSE KEY'), 'running heads removed');
  assert.ok(!/^\d+$/m.test(out), 'page numbers removed');
});

test('clean is idempotent', () => {
  const once = P.clean(fixture('inline-messy.txt'));
  assert.equal(P.clean(once), once);
  const nameOnly = P.clean(fixture('name-own-line.txt'));
  assert.equal(P.clean(nameOnly), nameOnly);
});

test('adding pages one at a time matches cleaning them all at once', () => {
  const raw = fixture('inline-messy.txt');
  const cut = raw.indexOf('lost the winter');
  const a = raw.slice(0, cut), b = raw.slice(cut);
  assert.equal(P.clean(P.clean(a) + '\n' + b), P.clean(raw));
  const cut2 = raw.indexOf('pery after dark');                 // mid-hyphenation
  assert.equal(P.clean(P.clean(raw.slice(0, cut2)) + '\n' + raw.slice(cut2)), P.clean(raw));
});

test('running heads in every layout: one line, split lines, act repeated per page', () => {
  const out = P.clean(fixture('running-heads.txt'));
  assert.equal(out, fixture('running-heads.expected.txt'));
  assert.equal(P.clean(out), out);
});

test('adding a page at a time (with running heads) matches all at once', () => {
  const raw = fixture('running-heads.txt');
  // Cut before every running head, the way an actor pastes a page at a time.
  const pages = raw.split(/\n(?=Page \d|Act I THE)/);
  assert.ok(pages.length >= 4);
  let script = '', ignore = '';
  for (const pg of pages) {
    const parsed = P.parse(script + '\n' + pg, { ignore });
    if (parsed.learned.length) ignore = [ignore, ...parsed.learned].filter(Boolean).join(', ');
    script = P.serialize(parsed);
  }
  assert.equal(P.clean(script, { ignore }), fixture('running-heads.expected.txt'));
});

test('real Live Text quirks: merged speeches, pencil notes, a lost ")", arrows', () => {
  const parsed = P.parse(fixture('livetext-quirks.txt'));
  assert.equal(P.serialize(parsed), fixture('livetext-quirks.expected.txt'));
  assert.deepEqual(parsed.dropped, ['5+2 nd', '00K', 'around']);
  assert.ok(!parsed.warnings.some(w => w.kind === 'unclosed'), 'the lost ")" is repaired, not just warned about');
  assert.equal(P.clean(P.serialize(parsed)), P.serialize(parsed));
});

test('a title’s period is not a sentence end', () => {
  const parsed = P.parse('MRS. HOLLOWAY. Come in.\nWREN. Thank you, Mrs. Holloway. MRS. HOLLOWAY. You’re welcome.');
  assert.deepEqual(speeches(parsed).map(s => s.speaker), ['MRS. HOLLOWAY', 'WREN', 'MRS. HOLLOWAY']);
  assert.ok(!parsed.cast.some(c => c.name === 'HOLLOWAY'));
});

test('practice sections are labelled with page ranges', () => {
  let raw = 'ACT I\n';
  for (let pg = 1; pg <= 12; pg++) {
    raw += 'Page ' + pg + '\n';
    for (let i = 0; i < 10; i++) raw += (i % 2 ? 'KEEPER' : 'WREN') + '. Page ' + pg + ' line ' + i + '.\n';
    if (pg === 4) raw += '(MUSIC IN for scene change.)\n';
  }
  const pr = P.buildPractice(P.parse(raw), 'WREN');
  assert.ok(pr.chunks.length >= 2);
  assert.match(pr.chunks[0].title, /^Act I · pp\. 1–4$/, 'first cut lands on the scene change');
  assert.ok(pr.lines.every(l => typeof l.page === 'number'));
});

test('misread running heads ("Act Ill", "Act I!") don’t start new sections', () => {
  const raw = [
    'ACT ONE', 'WREN. One.', 'Page 2', 'Act I', 'KEEPER. Two.',
    'ACT TWO', 'WREN. Three.',
    'Page 4', 'Act I', 'KEEPER. Four.',              // "Act II" misread as "Act I"
    'Act I!', 'Page 5', 'WREN. Five.',               // ...and as "Act I!"
    'ACT THREE', 'KEEPER. Six.',
    'Page 7', 'THE LIGHTHOUSE KEY', 'Act Ill', 'WREN. Seven.',
    'Act IIl', 'THE LIGHTHOUSE KEY', 'Page 8', 'KEEPER. Eight.'
  ].join('\n');
  const parsed = P.parse(raw);
  assert.deepEqual(parsed.scenes.map(s => s.title), ['ACT ONE', 'ACT TWO', 'ACT THREE']);
  assert.equal(speeches(parsed).length, 8);
});

test('a music cue list ("#1 Opening") is not read as headings', () => {
  const parsed = P.parse('#1 Opening Music\n#2 Wren’s Theme\nACT ONE\nWREN. Hello.');
  assert.deepEqual(parsed.scenes.map(s => s.title).filter(Boolean), ['ACT ONE']);
});

test('section names carry the act, in title case', () => {
  const parsed = P.parse('ACT ONE\nWREN. A.\nSCENE TWO\nWREN. B.\nACT TWO\nWREN. C.\nSCENE TWO\nWREN. D.');
  const pr = P.buildPractice(parsed, 'WREN');
  assert.deepEqual(pr.chunks.map(c => c.title), ['Act One', 'Act One · Scene Two', 'Act Two', 'Act Two · Scene Two']);
});

test('cast-list leaders on the front pages are ignored', () => {
  const parsed = P.parse('WREN ........................ 10 years old\nKEEPER .............. the keeper\nWREN. Hello.\nKEEPER. Hi.');
  assert.deepEqual(parsed.cast.map(c => c.name).sort(), ['KEEPER', 'WREN']);
  assert.equal(speeches(parsed).length, 2);
});

test('name on its own line, with a parenthetical under it', () => {
  const parsed = P.parse(fixture('name-own-line.txt'));
  const sp = speeches(parsed);
  assert.deepEqual(sp.map(s => s.speaker), ['WREN', 'KEEPER', 'WREN', 'OTIS', 'WREN']);
  assert.equal(sp[1].text, '(gently) Nobody asks the tide. Still it comes.');
  assert.equal(sp[2].text, "Fine. I'll go in.");
});

test('a missing ) does not swallow the next speech', () => {
  const parsed = P.parse('WREN. Hello there.\n(She waves and\nKEEPER. Hello yourself.\nWREN. Bye.');
  assert.deepEqual(speeches(parsed).map(s => s.speaker), ['WREN', 'KEEPER', 'WREN']);
  assert.ok(parsed.warnings.some(w => w.kind === 'unclosed'));
});

test('a caps name starting a line inside a direction stays in the direction', () => {
  const parsed = P.parse('WREN. Look!\n(The fog lifts.\nWREN kneels by the wall.)\nKEEPER. Well I never.\nWREN. Told you.');
  const blocks = parsed.scenes[0].blocks;
  assert.equal(blocks[1].type, 'direction');
  assert.equal(blocks[1].text, '(The fog lifts. WREN kneels by the wall.)');
  assert.deepEqual(speeches(parsed).map(s => s.speaker), ['WREN', 'KEEPER', 'WREN']);
});

test('a period lost by the OCR still finds the speaker', () => {
  const parsed = P.parse('WREN. One.\nKEEPER. Two.\nWREN Three, four.\nKEEPER. Five.');
  assert.deepEqual(speeches(parsed).map(s => s.text), ['One.', 'Two.', 'Three, four.', 'Five.']);
});

test('shouted dialogue in capitals stays dialogue', () => {
  const parsed = P.parse('WREN. I won’t go back. I won’t,\nI WON’T!\nKEEPER. All right.');
  assert.equal(speeches(parsed)[0].text, 'I won’t go back. I won’t, I WON’T!');
});

test('prose that starts with "Act" is not a heading', () => {
  const parsed = P.parse('WREN. I will.\nKEEPER. Then you must\nAct two of your life begins now.\nWREN. Fine.');
  assert.equal(parsed.scenes.length, 1);
  assert.equal(speeches(parsed)[1].text, 'Then you must Act two of your life begins now.');
});

test('ignore list drops a running head', () => {
  const out = P.clean('WREN. Hello\nLIGHTHOUSE KEY\nthere.\nKEEPER. Hi.', { ignore: 'lighthouse key' });
  assert.equal(out, 'WREN: Hello there.\nKEEPER: Hi.\n');
});

test('practice lines, cues, and group lines', () => {
  const parsed = P.parse(P.clean(fixture('inline-messy.txt')));
  const pr = P.buildPractice(parsed, 'WREN', { includeGroup: true });
  const said = pr.lines.map(l => l.speaker);
  assert.ok(said.includes('WREN AND OTIS'));
  assert.ok(said.includes('ALL'));
  const first = pr.lines[0];
  assert.equal(first.cue.speaker, 'KEEPER');
  assert.equal(first.spoken, 'I don’t care. Nobody asked me if I wanted to come to this horrid island.'.replace(/’/g, "'"));
  const turn = pr.lines.find(l => l.text.startsWith("That's a stupid"));
  assert.equal(turn.spoken, "That's a stupid thing to say. Everything here is grey.");
  const noGroup = P.buildPractice(parsed, 'WREN', { includeGroup: false });
  assert.ok(!noGroup.lines.some(l => l.speaker === 'ALL'));
  // Keys are stable across re-parsing and unique even for repeated lines.
  const again = P.buildPractice(P.parse(P.clean(fixture('inline-messy.txt'))), 'WREN', { includeGroup: true });
  assert.deepEqual(again.lines.map(l => l.key), pr.lines.map(l => l.key));
  assert.equal(new Set(pr.lines.map(l => l.key)).size, pr.lines.length);
});

test('repeated identical lines get distinct keys', () => {
  const pr = P.buildPractice(P.parse('WREN. No.\nKEEPER. Yes.\nWREN. No.\nKEEPER. Yes!\nWREN. No.'), 'WREN');
  assert.equal(pr.lines.length, 3);
  assert.equal(new Set(pr.lines.map(l => l.key)).size, 3);
});

test('long untitled scripts are split into practice parts', () => {
  let raw = '';
  for (let i = 0; i < 120; i++) raw += (i % 2 ? 'KEEPER' : 'WREN') + '. Line number ' + i + '.\n' + (i % 15 === 14 ? '(A pause.)\n' : '');
  const pr = P.buildPractice(P.parse(raw), 'WREN');
  assert.ok(pr.chunks.length >= 2);
  assert.equal(pr.chunks.reduce((n, c) => n + c.keys.length, 0), 60);
});

test('line warnings catch glued-on stage directions', () => {
  const parsed = P.parse('KEEPER. Hello.\nWREN. Hello. KEEPER crosses to the door.\nKEEPER. Bye.\nWREN. Bye. She turns and runs off.');
  const w = P.lineWarnings(parsed, 'WREN');
  assert.equal(w.length, 2);
});

test('segments split words and directions for hint modes', () => {
  const seg = P.segments("(crossly) I won't—not ever! — Never.");
  assert.equal(seg[0].dir, true);
  assert.equal(seg[0].s, '(crossly)');
  // A dash joining two words splits them, so each word gets its own first letter.
  assert.deepEqual(seg.filter(s => s.first).map(s => s.first), ['I', 'w', 'n', 'e', 'N']);
  assert.equal(seg[2].s, "won't—");
  assert.equal(seg[2].trail, '—');
  assert.ok(seg.some(s => s.punct));
});
