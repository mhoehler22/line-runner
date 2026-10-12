# Decisions

Why Line Runner is built the way it is. Each entry: the decision, why, and what it costs.
Newest last. All dated 2026-10-11 unless noted.

## D1. Everything stays on the device. No server, no accounts.
**Why:** a script is copyrighted, and the people using this are often students, some of them
minors. Keeping the text in the browser means nothing is published or hosted, there are no
accounts or personal data to protect, and hosting is free.
**Cost:** no automatic sync. Each device has its own copy; a backup file moves the script and
progress between devices (D9). Progress is tracked per device unless backups are swapped.

## D2. Bring your own text. The app never ships, fetches, or reproduces a script.
**Why:** the actor already has the script (a rental or purchased copy). Copying its text from
their own photos with their phone's OCR, for their own rehearsal, is the same private study aid
actors have always made: highlighting, cue cards, recordings. Distribution is the line the app
never crosses. The public repository holds only code and original test text.
**Also:** whoever develops the app (including an AI assistant) never transcribes, retypes, or
reads back real script text. Testing on a real script reports structure only (speaker sequence,
counts, warnings). Test fixtures are original dialogue in the same messy shape as real OCR output.
**Cost:** capture is the user's job; quality depends on their OCR (see D10).

## D3. Plain HTML, CSS, and JavaScript. No dependencies, no build step.
**Why:** it runs from any static host and works offline. It can be read and changed without
tooling. Nothing rots, and there is no `node_modules` (the source lives in a OneDrive-synced folder,
where heavy generated folders cause trouble).
**Cost:** hand-rolled DOM rendering and no type checking. `app.js` is one large file.

## D4. Canonical text is the stored source of truth.
**Why:** a simple line format (`# heading`, `Page N`, `(direction)`, `NAME: text`) that people can
read and edit by hand, and that `parse()` reads back unchanged. Idempotent cleaning makes three
things possible: appending pages one at a time, hand edits, and re-cleaning when the parser
improves.
**Cost:** the parser has to accept both raw OCR and canonical text, which constrains its rules
(for example, canonical `#` headings are always trusted).

## D5. Keep the printed page numbers.
**Why:** actors rehearse with the book in hand. Sections and lines show `p. 12` / `pp. 40–43`, so
any line in the app can be found in the book, and errors can be checked against the source.
**Cost:** running-head parsing is the most fragile part of the parser.

## D6. Self-graded practice with Leitner boxes. Solid = right 3 times.
**Why:** saying lines out loud is the point; automatic speech checking isn't reliable enough yet
(D7). Boxes 0–5 give a simple, honest progress measure and a "weakest first" order. Only a line's
first try in a session counts, so drilling a miss doesn't inflate it.
**Cost:** relies on honest grading. Type mode is the objective check.

## D7. Four modes: Run the scene, Cues only, Flashcards, Type first letters. No speech recognition (yet).
**Why:** Run builds scene flow and cue recognition by ear. Cues only is fast review. Flashcards
target weak lines. Typing first letters catches word-level slips objectively, on a phone or a
keyboard. Browser speech recognition needs the network and a microphone; school-managed
Chromebooks often block both, and accuracy on stage dialogue (dialect, archaic words) is uneven.
**Cost:** no hands-free checking. It's a candidate for later (ROADMAP).

## D8. Browser text-to-speech for the other parts.
**Why:** zero setup, offline on most devices, a distinct voice per character, adjustable speed.
**Cost:** robotic delivery, and voice choice varies by device. Recorded cues (a family member reading
the other parts) would be warmer: ROADMAP.

## D9. Device transfer by backup file.
**Why:** consistent with D1. One JSON file carries script, settings, and progress. Restoring
merges progress per line (newer wins).
**Cost:** a manual step. On iPhone, a Home Screen web app has storage separate from Safari's.

## D10. Capture with the phone's OCR (iPhone Live Text). Windows' built-in OCR was rejected.
**Why:** on the same two-page photo, Windows' OCR (`Windows.Media.Ocr`) agreed with Live Text on
only 91% of words. Highlighter on speaker names turned most of them into near-misses, which sends
lines to the wrong character. Live Text read the spread in the right order and got speaker labels
right. For many photos, an iPhone Shortcut runs the same engine in one go (Find Photos → Extract
Text from Image → Combine Text → Copy to Clipboard).
**Cost:** batch capture needs an iPhone; Android would use Google Lens page by page.

## D11. A heuristic parser, not a model.
**Why:** deterministic, offline, instant, and testable with fixtures. Sending script text to a
hosted AI model would contradict D1 and D2.
**Cost:** each new layout or OCR quirk needs a new rule and a test. See PARSER.md for every
rule and the risk it accepts.

## D12. Hosting: GitHub Pages, a public repository, a generic name.
**Why:** free, HTTPS (required for the service worker and clipboard), and one address that works
on an iPhone and a Chromebook. The repository holds no script text and no personal details, so it
can be public. Commits use the GitHub no-reply email so no personal address is published.
**Cost:** anyone can see the code, which is fine and intended.

## D13. The user's own data never goes in the repository.
**Why:** test fixtures are original; documentation describes the real-world script generically;
the user's name and the play's title stay out. Notes about the real script live outside the
repository in the project folder.
**Lesson:** two character names slipped into code comments in the first public commits and were
replaced. The release check is now a search of the repository for names before every push.
