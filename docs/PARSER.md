# The parser

`parser.js` turns text copied from photos of a printed play into a clean script, then builds
practice material for one character. It is deterministic, offline, and heuristic: every rule
below exists because real OCR output (iPhone Live Text on a published acting edition)
needed it. Each rule notes the risk it accepts.

```js
LineParser.parse(text, { ignore })   // -> { scenes, cast, warnings, learned, dropped }
LineParser.serialize(parsed)         // -> canonical text
LineParser.clean(text, opts)         // serialize(parse(text, opts))
LineParser.buildPractice(parsed, me, { includeGroup })  // -> { lines, chunks, byKey }
LineParser.lineWarnings(parsed, me)  // -> [{ scene, block, msg }]
LineParser.segments(text)            // words and ( ) directions, for hints and typing
LineParser.spoken(text)              // text with every ( … ) and [ … ] removed
```

## Canonical format

One block per line. This is what is stored, what **Edit text** shows, and what `parse()` reads
back unchanged:

```
# Act One — Scene 2              section heading
Page 12                          the printed page number for the blocks that follow
(Lights rise on a rocky shore.)  stage direction
WREN: (crossly) I won't.         speech: NAME, colon, text; ( ) inside is a direction, not spoken
```

**Invariants (tested):**

1. `clean(clean(x)) === clean(x)`: cleaning is idempotent.
2. `clean(clean(a) + b) === clean(a + b)`: adding pages one at a time gives the same result as
   pasting them all at once, including a speech or a hyphenated word that runs across a page break.

## Pipeline

### 1. Line normalisation (`normLine`)
- NBSP and tabs become spaces; whitespace collapses.
- **Arrows are stripped** with up to three capitals after them (`→ L`, `↳ DSR`). These are
  pencilled blocking notes. The capitals after an arrow are kept if they are followed by `.` or
  `:` (`→ MRS. HOLLOWAY.` keeps the speaker).
- **Nested parentheses are repaired** (`fixNested`). Directions never nest, so
  `(He laughs. (MUSIC IN.)` means the OCR lost a `)`, and one is inserted before the second `(`.

### 2. Page furniture (`furniture`)
Returns `null` for real text, or `{ page }`:
- Bare page numbers: `12`, `Page 12`, `(12)`. These become page markers.
- Running heads that carry a page number: `12 THE LIGHTHOUSE KEY`, `THE LIGHTHOUSE KEY 14`,
  `Page 10 THE LIGHTHOUSE KEY Act I`, `Act I THE LIGHTHOUSE KEY Page 11`, `Act I 13`. The body
  must be short and Title Case or capitals. *Risk:* a line like `Number 7` alone would be taken
  as furniture; a speech line (`OTIS. Number 7`) is exempt.
- Rules and dot leaders (`--------`, `WREN .......... 10 years old` from a cast list).
- Lines containing any phrase in the user's **ignore** list.

### 3. Pencil-note removal (in `prepLines`; everything removed is returned in `dropped`)
- **Garbage tokens** mix digits with letters or `+ * =` (`00K`, `5+2`): OCR of handwriting.
  Scripts spell numbers out. Music cues (`[I, #7]`) are exempt.
  - A line of at most 3 tokens, all garbage or tiny lowercase fragments, is dropped.
  - A garbage tail after the sentence ended (`…about him. 5+2 nd`), outside any parentheses, is
    cut off.
- **Lowercase stragglers:** a line of one or two lowercase words with no punctuation, right after
  a line ending in `. ! ? )` (not `...`), and not followed by a lowercase continuation, is a
  pencil note (`around`). Printed text after a sentence end starts with a capital.
- *Risk:* a real one-word line could be dropped. That's why the app lists every dropped bit after
  each paste.

### 4. Learned running heads
An all-caps line of 3+ words (no `. ! ? ( )`) that appears twice or more is a running head (the
play's title on every page) and is dropped. Earlier clean-ups are counted too: a lone occurrence
kept as a `(THE LIGHTHOUSE KEY)` direction counts. Learned phrases are returned in `learned`, and
the app adds them to the ignore list so single-page pastes later drop them.

### 5. Hyphen rejoin
`gar-` + `den` → `garden` when a line ends in a lowercase letter and `-` and the next line starts
lowercase. *Risk:* a real compound split at a line end loses its hyphen. Live Text also rejoins
words itself but keeps the hyphen (`re-spond`), which is left alone.

### 6. Cast detection (`findCast`)
Speaker candidates are counted as **strong** (`NAME.` or `NAME:` followed by text, or `NAME (paren)
text`) or **name-only** (the name alone on its line).
- Names: all-caps words, optional title (`MR. MRS. MS. DR. ST. SIR LADY …`), up to 4 words,
  `&`/`AND` joins (`WREN AND OTIS`). Titles are normalised (`MRS HOLLOWAY` = `MRS. HOLLOWAY`).
- **Mid-line speakers** count as strong: `…(KEEPER exits.) MRS. HOLLOWAY. I suppose…`.
  Required: a sentence end or `)` before, outside parentheses, `[.:]` after, then a capital or
  quote. The period of a title is not a sentence end (`afterTitle`), so `MRS. HOLLOWAY` never
  yields a speaker `HOLLOWAY`.
- Excluded: a stop-list of capitalised non-names (`ACT SCENE LIGHTS NO YES OH OK MR MRS…`),
  single letters, and more than 3 real words. Name-only candidates also can't start with
  `THE A AN AT IN ON OF LIGHTS FADE …`.
- Lines inside an unclosed `(` are skipped, with the same safety valve as below.

### 7. Merged-speech split (`splitMerged`)
Live Text runs short speeches together onto one line: `BOY. Is! (MUSIC IN.) WREN. Isn't!` The
line is split before any known strong speaker that follows a sentence end, outside parentheses
(paren depth tracked across lines), and not after a title period. The cast is re-detected after
splitting.

### 8. Main loop (`parse`)
State: the block list, `recv` (a block still inside an open `(`), the paren `depth`, the current
`page`, and `lastAct`.

- **Page markers** set `page`; every new block records the page it starts on.
- **Inside an open `(`:**
  - A new `(` at the start of a line closes the old one first. A `(` before any `)` mid-line gets
    a `)` inserted before it.
  - **Safety valve:** a properly punctuated line for a known strong speaker with no `)` force-closes
    the parenthesis (`unclosed` warning), so one lost `)` can't swallow the rest of the play. A
    direction line that merely starts with a name (`WREN kneels by the wall.)`) does not trigger it.
  - When a direction closes and text follows (`… looks out.) I can't see it.`), the tail goes back
    to the speech.
- **Headings** (`# …`, `ACT/SCENE + number`, `PROLOGUE/EPILOGUE`): a prose line starting
  `Act two of…` is rejected. Running heads are ignored when:
  - the act equals the current act (OCR numeral variants normalised: `Ill`, `IIl`, `I!` → `III`, `II`), or
  - it is a bare act line in mixed case (`Act II`) next to a page marker (perhaps with the title
    line between), and an act heading has already been seen. Real act headings in capitals
    (`ACT II`) or spelled out (`Act Two`) are trusted; canonical `#` headings are always trusted.
  - *Risk:* a real mixed-case `Act III` at the top of a page would be skipped; its blocks then join
    the previous section.
- **Speakers** (`matchSpeaker`): inline, name + paren, name-only, or (for strong names) a name
  whose period the OCR lost (`WREN I won't.`). `NAME (CONT'D)` at the top of a page merges into
  the speech it continues.
- **Lines starting with `(`:**
  - The direction joins the current speech if the speech is still empty (`WREN` / `(gently)` /
    text) or if text follows the `)` on the same line.
  - Otherwise it is a standalone direction.
- **All-caps lines** with no `!`/`?` that aren't names become directions (a running head or a caps
  stage direction). Shouted dialogue (`I WON'T!`) keeps its punctuation and stays dialogue.
- **Anything else is continuation.**
  - It appends to the last speech.
  - If a direction sits between that speech and this text, the direction is folded into the speech
    as `( … )`: a speech interrupted by a direction, often across a page break.
  - With no speech before it, it becomes a description block.

### 9. Grouping and output
- A heading with nothing under it merges into the next (`ACT ONE` + `SCENE 1` →
  `ACT ONE — SCENE 1`). A trailing empty heading is kept, so the next paste continues under it.
- The cast is listed by line count. One-line speakers produce a `single` warning (useful for
  spotting OCR-mangled names).
- `serialize` writes `# title`, `Page N` when the page changes, `(direction)` (one pair of
  parentheses, inner ones dropped rather than nested), and `NAME: text`.

## Practice material (`buildPractice`)

- **Whose lines:** `speaker === me`, or a shared name that contains `me` (`WREN AND OTIS`,
  `WREN & OTIS`). With `includeGroup`, also `ALL / BOTH / EVERYONE / CHORUS / ENSEMBLE /
  COMPANY / OTHERS`. Lines with no spoken words (`WREN: (She nods.)`) are skipped.
- **Cue:** the previous speech with words in the same section. It may be the actor's own line
  (`mine: true`). With none, the nearest earlier direction becomes context ("start of section").
- **Sections:** a scene longer than 45 blocks (×1.4 slack) is split near every 45 blocks. The cut
  prefers a direction matching
  `scene change | lights up/down/fade… | blackout | curtain | transition | time passes …`, then
  any direction, then a hard cut. A short tail merges into the previous part.
- **Labels:** title case (Roman numerals kept), the act carried onto scene titles, and the page
  range when split: `Act Two · Scene Three · pp. 40–43`. Untitled material is `Opening` /
  `Script` / `Part N`.

## Warnings (`lineWarnings`, actor's lines only)
- A cast name in capitals inside the spoken text: a direction or another speech is probably stuck on.
- Direction-like phrases outside parentheses (`enters`, `exits`, `crosses to`, `lights fade`,
  `she turns`…).
- Someone `enters` in a parenthetical mid-line: the next speaker's name may have been lost.
- More than 120 words: worth checking it's all theirs.

## Display helpers
`segments()` splits a line into words and `( … )` / `[ … ]` groups. A dash between words ends the
first word (`won't—not` → `won't—`, `not`) so each gets its own first letter. Each word carries
`lead`, `first`, `mid`, `trail` for the first-letter hint and typing modes.

## Known limitations
- **Directions without parentheses** (italic-only editions) get glued onto speeches. The Live Text
  copy loses italics. The warnings catch some of it.
- **Misread letters** inside ordinary words can't be detected; the actor's read-through against
  the book is the fix.
- **Garbled speaker labels** (`WREM` for `WREN`) become one-line speakers. They're flagged as
  `single` but not auto-corrected (see ROADMAP: fuzzy matching against the cast).
- **Front and back matter** (title page, cast list, music cue list, notes) is mostly neutralised
  but still lands as junk sections; the **Remove section** button handles it.
- **Song lyrics** and other layouts (name centred on its own line, screenplay format) are only
  lightly tested.
- **Trailing ordinals** like `2nd` after a sentence end would be dropped as pencil garbage.

## Tests
`test/parser.test.js` covers: messy inline pages; idempotence; page-by-page equals all-at-once
(including running heads and mid-hyphen cuts); running heads in every layout; real Live Text
quirks (merged speeches, pencil notes, lost `)`, arrows); title periods; page-range labels;
misread act heads; music cue lists; act-qualified section names; cast-list leaders; name-only
format; unclosed `(`; caps names inside directions; lost speaker periods; shouted dialogue; prose
starting with "Act"; the ignore list; cues and group lines; stable unique keys; long-script
sections; line warnings; segments.
