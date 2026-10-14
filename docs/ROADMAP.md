# Roadmap and open problems

Improvement ideas found while building and using the first version, grouped by area. None are
committed work. Each says what it would fix.

## Capture
- **Fuzzy speaker correction.** A one-line speaker one or two letters away from a main character
  (`WREM` → `WREN`, `KEPER` → `KEEPER`) and sitting between that character's scene partners is almost
  certainly a misread. Suggest the fix in Check spots, with one tap to accept.
- **Front/back matter detection.** Offer to remove material before the first act heading and after
  the last speech, such as cast lists, music cue lists, and "Playwright's notes".
- **Share target.** Register the app as a PWA share target so text shared from Photos or Shortcuts
  lands straight in Add pages.
- **In-app OCR.** Tesseract.js or a native wrapper using Apple Vision would let the app read photos
  itself. Weigh accuracy (D10), app size, and keeping everything on the device.
- **Hyphen clean-up.** Live Text keeps the hyphen when it rejoins a word broken at a line end
  (`re-spond`). A small word list could tell real compounds from line breaks.
- **Layouts:** song lyrics (indented or in capitals), names centred on their own line,
  screenplay format, bilingual editions.

## Practice
- **Speech recognition mode** (where allowed): listen to the actor's line and highlight missed or
  changed words. Fall back gracefully when the microphone or network is blocked (school devices).
- **Recorded cues:** let a parent or scene partner record the other parts once. Warmer than
  text-to-speech, and it carries real timing and emotion.
- **Blocking notes:** keep pencil blocking notes ("cross L", "sit") as separate notes attached to a
  line instead of discarding them.
- **Spaced repetition with due dates** keyed to the off-book date, plus a daily goal and streak.
- **Paraphrase drill:** describe the moment ("the keeper has just asked…") and have the actor give the
  line, to build sequence memory.
- **Run with timing:** pause for the actor's line for roughly its natural length instead of waiting
  for a tap, for performance-speed runs.
- **Musical numbers:** lyric drills, with entrance cues taken from music cue numbers in directions.
- **Should a hinted "Got it" count less?** Today it moves a line up a box like an unaided one, so
  "solid" can include lines that still need the first letters. Option: treat it as Shaky. Decide
  after the practice record (D14) shows how often hints are used.
- **Read the practice record:** a small view or script over a backup that answers "after a hinted
  try, is the next unaided try better?" and "which modes get used?"

## Devices and data
- **Optional sync** that keeps D1 intact: an export to the user's own cloud storage, or a sync code
  that pairs two devices, end-to-end encrypted. No script text on any shared server.
- **Progress merge across devices** without a full restore (progress-only export).
- **Multiple scripts** (several shows, or one show plus an audition piece).

## Ensemble and director features (needs careful thought about D1 and D2)
- A director shares a *cleaned* script with the cast. That is distribution: it must respect the
  licence (many licences forbid copies), so probably out of scope without a publisher agreement.
- The cast-wide equivalent that stays within the rules: each actor captures their own copy, and the
  app shares only progress or schedules.

## Engineering
- Split `app.js` into modules (storage, TTS, practice engine, views) once there's a reason to add
  a build step, or use native ES modules without one.
- End-to-end tests of the practice engine (Playwright), plus the browser smoke test in
  ARCHITECTURE.md automated.
- Accessibility pass: screen reader labels for practice controls, focus management in the sheet
  and the overlay, reduced-motion is already respected.
- Version banner / "update available" prompt from the service worker.
