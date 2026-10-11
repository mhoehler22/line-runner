# Line Runner

Learn your lines. A small web app that reads your cues aloud, waits for you to say your line,
and keeps track of which lines you know.

- **Bring your own script.** Photograph a page, copy the text (iPhone Live Text, Google Lens),
  paste it in. Line Runner cleans it up: page numbers and running heads removed, stage directions
  kept in parentheses, one line per speech.
- **Four ways to practice:** run a scene with the other parts read aloud, jump cue to cue,
  flashcards that bring back your misses, or type the first letter of each word.
- **Private.** Everything stays in your browser. No accounts, no tracking, nothing uploaded.
  Your script is for your own rehearsal; please don't share its text.

Works offline after the first visit, and can be added to an iPhone Home Screen or installed on a
Chromebook.

## Development

Plain HTML, CSS, and JavaScript. No dependencies, no build step.

```bash
node tools/serve.js          # http://localhost:8137
node --test "test/*.test.js" # parser tests
```

Test fixtures are original dialogue written for testing.
