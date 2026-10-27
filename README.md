# Galvanize

A Frankenstein study race for the English II exam on Volumes 1 and 2. A static web app: open the link on a phone, no sign-up, nothing collected. Progress is stored in the browser on each device.

Live at https://jordanpaya.github.io/frankenstein-study/

## Running it locally

Any static file server works. From this folder:

    npm run serve

then open http://127.0.0.1:8765 in a browser. There is no build step.

## Editing content

All questions, passages, quotes, timeline events, characters and vocab live in `data/content.json`. Edit that file and reload; no code changes are needed. After editing, run the checker:

    npm run check-content

It confirms the file parses, every Part 3 question points at a real passage, every question has exactly three distractors, ids are unique, and there are no em dash characters.

Content was written from memory of the novel and every item is marked `verified: false`. The app shows a notice saying so. Players can flag an item from the answer screen; flags are stored on their device and can be copied as text from Settings.

## Tests

    npm test

Tests cover shuffling, question picking without repeats, scoring, and progress tracking.

## House style

No em dash characters anywhere: content, interface text, comments, or commit messages. No chapter or page numbers are shown in the app.
