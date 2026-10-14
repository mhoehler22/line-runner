# Architecture

Line Runner is a static web app: plain HTML, CSS, and JavaScript, with no dependencies and no
build step. It runs entirely in the browser. There is no server, no account, and no network
traffic after the first load, apart from the service worker checking for updates.

## Files

| File | Role |
|---|---|
| `index.html` | Page shell: top bar (title and off-book countdown chip), `#view` for the current tab, bottom tab bar, `#sheet` (mode picker), `#practice` (full-screen practice overlay), `#toast`. |
| `styles.css` | Design tokens on `:root`, light and dark themes (`prefers-color-scheme`, or `data-theme` to force one), mobile-first layout. System fonts only, so it works offline and on locked-down school networks. |
| `parser.js` | Turns pasted OCR text into a clean script and builds practice material. UMD wrapper: `window.LineParser` in the browser, `require()` in Node. See [PARSER.md](PARSER.md). |
| `app.js` | Everything else: storage, derived state, text-to-speech, router and views, script actions, the practice engine, backup and restore, event wiring. One IIFE. |
| `sw.js` | Service worker. Network first, cache as fallback, so the app works offline and updates show up when online. |
| `manifest.webmanifest`, `icon.svg`, `icon-180/192/512.png` | Home Screen install (iPhone) and app install (Chromebook). Full-bleed square PNGs; the OS rounds the corners. |
| `tools/serve.js` | Tiny static server for local testing (`node tools/serve.js` → http://localhost:8137). |
| `test/` | Parser tests (`node --test "test/*.test.js"`) and fixtures. Fixtures are original dialogue written for testing. |

## Data flow

```
paste (OCR text)
  └─> LineParser.parse(existingScript + "\n" + pasted, { ignore })
        ├─ learned running heads ──> settings.ignore (so later pastes drop them too)
        ├─ dropped pencil marks   ──> lastDropped (shown under "Add pages")
        └─ serialize()            ──> state.script (canonical text)  ──> localStorage
                                                   │
derive():  parse(state.script) ─> buildPractice(me) ─> lines, chunks (sections), byKey
                               └> lineWarnings(me)  ─> "Check N spots"
```

The canonical script text is the source of truth. Everything else is derived from it on load
and after every change. Because `parse(serialize(x))` round-trips exactly, new pages can be
appended to the existing canonical text and re-cleaned together. A speech that runs across a
page break joins up correctly, and hand edits survive.

## Stored state

One `localStorage` key, `lineRunner:v1`:

```js
{
  script: "…canonical text…",
  me: "WREN",                       // the character being practised
  demo: false,                      // demo scene loaded (cleared on first real paste)
  undo: "…previous script…",        // one level of undo for Add / Edit / Remove section
  lastDropped: ["00K", "around"],   // what the last paste skipped
  tipClosed: false,                 // iPhone "Add to Home Screen" tip dismissed
  settings: {
    offBook: "2026-10-30", rate: 1, speakCues: true, showCueText: true, speakMine: false,
    showDirections: true, includeGroup: true, british: true, voiceMap: {}, ignore: "",
    sessionSize: 20, theme: ""
  },
  progress: { "<lineKey>": { b: 2, n: 5, m: 1, h: 1, t: 1791755658935 } },
  log: [ { t: 1791755658935, s: 1791755600000, k: "<lineKey>", m: "cards", g: 2, h: 1 } ]
}
```

Progress per line: `b` = Leitner box 0–5, `n` = attempts, `m` = misses, `h` = attempts that used
a hint (absent until the first one), `t` = last practised. Like `b`, these count only a line's first
try in a session.

**Practice record (`log`):** one entry per graded try, re-drills included: `t` = time, `s` =
session (its start time), `k` = line key, `m` = mode, `g` = grade 0–2, `h` = 1 if the Hint button
was used before grading (always 0 in type mode, which has no hint). The newest 10,000 entries are
kept. It holds line keys only, never text. It exists to answer questions such as "does a hint
help?" and "which modes get used?" (DECISIONS D14). Settings shows a one-line count; Reset
progress, loading the demo, and clearing the demo empty it.

**Line keys** are an FNV-1a hash of `speaker | spoken text (lowercased, letters and digits only) #
occurrence`. Re-cleaning the script never loses progress. Editing a line's words gives it a new
key, which correctly resets that line. Identical lines ("No.") get distinct keys by occurrence.

All storage calls are wrapped in try/catch. If saving fails, the app says so and points to
Download backup.

## Views

Hash router: `#/home` (Practice), `#/script`, `#/settings`, `#/help`. Each view renders HTML
strings into `#view`. A single delegated `click` handler dispatches on `data-act`, and a single
`change` handler on `data-change`.

- **Practice (home):** countdown, overall progress bar (solid / learning / new), a suggested pace
  ("about N lines a day"), Practice my weakest N, Whole script…, and one card per section that
  has the actor's lines.
- **Script:** character picker; **Add pages** (paste box, Undo last add, skipped-bits note);
  **Check N spots** (warnings with Show buttons); **Read through** (rendered script with the
  actor's lines highlighted, page markers, **Remove section** per section, **Edit text** for
  the raw canonical text).
- **Settings:** character, off-book date, practice toggles, voice speed and per-character voices,
  cleanup ignore list, backup and restore, reset.
- **Help:** capture steps (including the iPhone Shortcut for batch capture), checking, the four
  modes, a suggested routine, keyboard shortcuts, moving between devices, privacy.

## Practice engine

A session (`sess`) is created by `startPractice({ mode, chunks | keys, order, size, title })`.

| Mode | Flow |
|---|---|
| `run` | Walks every block of the chosen sections in order. Other characters' lines are shown (or hidden: "listen…") and spoken; directions are shown; the actor's turn stops for them. |
| `cues` | Same walk, but only the speech right before each of the actor's lines is played, cut to its last 14 words. |
| `cards` | A queue of the actor's lines (script order, weakest first, or shuffled). Cue box on top, line card below. |
| `type` | Same queue as cards; the actor types the first letter of each word and the app grades them. |

**The actor's turn** has three hint levels: 0 = hidden ("say it out loud"; the first stage
direction stays visible as context), 1 = first letter of each word with a faint bar for the rest,
2 = the full line. After revealing, they grade themselves: **Missed / Shaky / Got it**.

**Grading (Leitner boxes):** Got it → `b + 1` (max 5); Shaky → `b − 1` if `b > 1`, otherwise
unchanged; Missed → 0. A line is **solid** at `b ≥ 3`. Only a line's **first try in a session**
changes its box, so re-drilling a miss can't inflate it.

**Requeue (cards/type):** a missed line comes back 3 cards later (up to 2 retries), a shaky one
5 cards later (once).

**Weakest first:** sort by box (missed lines before new ones, new before box 1…), then
least-recently practised, then random.

**Type mode:** each word must be started with the right letter. A wrong letter shakes the word
and counts an error; two wrong letters reveal it as missed. Score: no errors → Got it;
≥ 85% words right first time → Shaky; otherwise Missed. A hidden `<input>` captures keystrokes
so the iPhone keyboard appears; the document keydown handler covers a Chromebook keyboard if focus
wanders.

**Cancellation:** run mode is a step loop (`runStep`). Each step bumps `sess.gen`; a speech
promise only advances the loop if its generation is still current. Skip, Pause, and Stop all
bump the generation and cancel speech, so no step ever advances twice.

**Summary:** got / shaky / missed tallies, the lines to work on (with cue and page), and
**Drill these N**.

**Keyboard (Chromebook):** Space/Enter show line or next · H hint · 1 2 3 grade · R replay cue ·
Esc stop.

**Screen Wake Lock** keeps the screen on during practice where supported.

## Text-to-speech

Browser `speechSynthesis` only, with no audio files.

- English voices only. Novelty voices (Bells, Zarvox…) are filtered out of automatic assignment.
- Each character keeps a voice. Characters are ranked by line count and assigned round-robin; once
  voices run out, pitch varies (1.0, 0.88, 1.14). "Prefer British voices" puts en-GB voices first.
  Per-character overrides live in `settings.voiceMap`.
- Text is split into sentence-sized pieces of at most 200 characters (Chrome cuts off long
  utterances). Each piece has a timeout fallback (2.5 s + 650 ms per word, scaled by rate) in case
  `onend` never fires. Utterances are kept referenced so Chrome doesn't drop their events.
- iOS only speaks after a tap, so the first tap primes speech with a silent utterance.
- Parentheticals are never spoken (`LineParser.spoken()`).

## Moving between devices

Every device keeps its own copy. **Download backup** writes
`{ app: "line-runner", version: 1, exported, script, me, settings, progress, log }`. **Restore
backup** replaces the script (after a confirm if one exists), merges settings, merges
progress, keeping whichever record of each line is newer, and merges the practice records from
both devices in time order without duplicates. **Copy script text** puts the
canonical text on the clipboard; pasting it into Add pages on another device rebuilds the same
script.

iPhone notes: a Home Screen web app has its own storage, separate from Safari's. Safari may also
clear a site's storage after 7 days without a visit, which a Home Screen app avoids. The app
shows a one-time tip and calls `navigator.storage.persist()` when available.

## Offline and updates

`sw.js` pre-caches the app shell, serves network-first, and falls back to the cache (and to
`index.html` for navigation). **Bump `CACHE` in `sw.js` on every release** so installed copies
drop old files. The worker registers only on `https:`, so local `http://localhost` testing is
never cached.

## Deployment

GitHub Pages, served from `main` at the repository root. Publishing an update means commit and
push; the "pages build and deployment" workflow takes under a minute. Check the live files
afterwards (for example, that `sw.js` shows the new cache name).

## Testing

- `node --test "test/*.test.js"` runs the parser tests (24 at the time of writing). Fixtures are
  original text shaped like real OCR output.
- Browser smoke test before each release: load the demo scene; run each of the four modes
  (hint, reveal, grade, requeue, summary); add pages one at a time; trigger a warning and Show
  it; Undo; Remove section; Settings at 375 px width with no horizontal overflow; console free
  of errors.
