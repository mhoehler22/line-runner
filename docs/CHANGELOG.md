# Changelog

## 2026-10-13 — Practice record; tapped "Missed" fixed
- **Practice record:** every graded try is logged on the device (line key, mode, grade, whether
  Hint was used) and goes into backups. Each line's progress also counts hinted attempts. Settings
  shows a one-line summary. See ARCHITECTURE "Stored state" and DECISIONS D14.
- **Fix:** tapping **Missed** passed no grade (the button builder skipped a value of 0), so
  tapped misses were left out of the summary and Drill these and never added to a line's miss
  count. The box still dropped to 0. The keyboard shortcut was unaffected.
- Help → Privacy now describes the practice record. Service worker cache `v4`.

## 2026-10-11 — `e9bd489` Documentation
Added `docs/` (architecture, parser rules, decisions, changelog, roadmap), linked from the README.
Every code comment and help example now uses the test play's names. Service worker cache `v3`.

## 2026-10-11 — `6c527c1` Use the test play's names in code comments
Two code comments used character names from the first real script as examples. They were
replaced with names from the test fixtures (see DECISIONS D13).

## 2026-10-11 — `2f8e7d8` Handle a whole-play paste
First full-script capture (about 40 photos through an iPhone Shortcut, ~800 speeches) exposed
problems the page-at-a-time tests hadn't:
- **Running heads misread by the OCR** (`Act Ill`, `Act I!`, `Act IIl`, an `Act II` read as `Act I`)
  each started a fake section: 44 sections instead of 12. Fixes: numeral normalisation in `actKey`,
  and a bare mixed-case act line next to a page marker is treated as a running head.
- **Music cue lists** (`#1 Opening Music`) were read as canonical `#` headings.
  `RE_CANON_HEADING` now needs a space after `#` and no digit.
- **Section names** carry the act and use title case: `Act Two · Scene Three · pp. 40–43`
  (three different acts each had a "Scene Two").
- **Remove section** button in the read-through (with undo) for title pages, cast lists, music
  lists, and notes.
- Help: two-page spreads are fine; batch capture with an iPhone Shortcut.
- Service worker cache `v2`. Tests: 24.

## 2026-10-11 — `8770aa7` First release
Published to GitHub Pages. Includes everything below.

### Live Text quirks (found on a real photographed spread, before the first release)
- **Merged speeches:** `splitMerged` splits `… (MUSIC IN.) WREN. Isn't!` into two speeches. Mid-line
  speakers count toward the cast; a title's period (`MRS.`) is never a sentence end.
- **Pencil notes:** garbage tokens (`00K`, `5+2`) removed whole-line or as a tail; lowercase
  stragglers after a sentence end removed; arrows (`→ L`) stripped; everything removed is listed
  to the user ("Skipped from your last paste…").
- **Lost `)`:** nested parentheses repaired on a line and across lines.
- Directions keep one pair of parentheses (inner ones dropped, not nested), keeping round trips stable.

### Real layout support (from photos of a published acting edition)
- Page numbers tracked from running heads and kept as `Page N` lines; sections labelled with page
  ranges; lines show `p. N`.
- Running heads in every layout (one line, split over three lines, page number at either end);
  repeated all-caps title lines learned and added to the ignore list; the act repeated in every
  page head ignored.
- Long acts with no scene headings split at "scene change" directions.
- Cast-list dot leaders ignored.

### App
- Script tab: Add pages (incremental, idempotent), Undo last add, Check N spots, read-through
  with highlighting and page markers, Edit text.
- Practice: Run the scene, Cues only, Flashcards (requeue misses), Type first letters (auto-graded);
  hints (first letters, then full); Leitner progress; summary with Drill these.
- Home: off-book countdown, progress bar, suggested pace, sections with mini progress bars.
- Text-to-speech with a voice per character, British preference, speed control.
- Settings: off-book date, practice toggles, voices, ignore list, backup and restore, copy script,
  reset, erase.
- Demo scene (original text); iPhone Add to Home Screen tip; wake lock; persistent storage
  request; offline service worker; manifest and icons; light and dark themes; keyboard shortcuts.

### Parser core
- Inline (`NAME. text`) and name-on-own-line formats, `NAME (paren). text`, titles, shared names,
  `(CONT'D)` merging, a safety valve for runaway parentheses, a lost-period fallback, shouted
  dialogue, headings with prose rejection, hyphen rejoin, idempotent canonical format.
