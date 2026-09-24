# Doodle Dash — approved spec

A phone-first, real-time multiplayer drawing-and-guessing party game (skribbl.io-style) for
2–8 players who join by room code from their own devices. No logins, no installs, no ads.
Built for the Handshake "Create a Multiplayer Game" challenge (deadline Oct 31, 2026).

Contest requirements this must satisfy:
- At least two players can join from separate devices.
- The game has real rules a player could follow without anyone explaining them (in-app "How to play").
- It's live at a public URL (Render free web service).

What should make it stand out from skribbl.io: genuinely good on phones, one-tap join by QR/link,
difficulty-multiplier word choice, and an end-of-game replay gallery people want to share.

---

## 1. Rules (player-facing — these exact rules appear in the in-app "How to play")

1. **Join.** Enter a name, create a room or type a 4-letter code. The host can show a QR code / share a
   link (`/r/ABCD`) so others join in one tap. 2–8 players.
2. **Lobby.** Host sets rounds (2–5, default 3), draw time (60 / 80 / 100 s, default 80) and a word pack
   (Everyday, Animals, Food, Places, Actions, Mixed, or Custom words). Start needs at least 2 players.
3. **Each turn.** Every player draws once per round.
   - The drawer picks 1 of 3 words — one easy, one medium, one hard — within 15 s (else a random one).
   - Guessers see only blanks `_ _ _ _ _` (spaces and hyphens shown). One letter is revealed at 50 % of
     the draw time and another at 75 % — never revealing more than half the letters.
   - Guessers type guesses in chat. A correct guess shows "**Ana guessed it!**" to everyone — the word
     itself is never echoed. A guess one letter off shows a private "**So close!**" to that guesser only.
   - Players who already guessed (and the drawer) chat in a private channel only they can see, so they
     can't leak the answer. The drawer cannot post in the public guess chat during their turn.
   - The turn ends when the timer runs out or every guesser has guessed. The word and the turn's
     points are revealed for 5 s.
4. **Scoring.**
   - Guesser: `round((100 + 200 * timeLeft / drawTime) * mult)` — 100 to 300 base, faster = more.
   - Drawer: `50 * (number of correct guessers) * mult`. Nobody guesses = drawer scores 0.
   - Difficulty multiplier `mult`: easy x1, medium x1.5, hard x2 (applies to guessers and drawer).
5. **End.** Podium (top 3), then the **Gallery**: every drawing of the game replays stroke-by-stroke with
   its word and artist; any drawing can be saved as PNG. "Play again" returns everyone to the lobby in
   the same room with scores reset.

## 2. Game mechanics (server-authoritative)

- **Rooms.** 4-letter codes from `ABCDEFGHJKMNPQRSTUVWXYZ` (no I/L/O), case-insensitive. Max 8 players;
  a 9th gets "Room is full". Rooms are garbage-collected after 30 min with no connected players.
- **Identity & reconnect.** Client stores a random token in `localStorage`; server maps token to seat.
  Refresh / phone lock / network blip = rejoin the same seat with the same score. A disconnected seat is
  kept for 60 s (shown as "reconnecting..."), then removed.
- **Names.** 1–16 chars, trimmed; duplicates get a suffix ("Sam 2"). Each player gets an avatar colour.
- **Host.** Room creator. If the host leaves, the longest-seated connected player becomes host.
- **State machine:** `lobby -> choosing (15 s) -> drawing (drawTime) -> reveal (5 s) -> ... -> gameOver`.
  A round = every player (in seat order at round start) draws once. Players who join mid-game become
  guessers immediately and enter the draw order from the next round.
- **Drawer disconnects** during choosing/drawing and isn't back within 10 s: the turn ends, nobody loses
  points already earned.
- **The word never reaches a guesser's browser before reveal** — guessers receive only the mask
  (length, positions of spaces/hyphens, revealed letters). The 3 word choices go only to the drawer.
- **Guess matching.** Normalise both sides: lowercase, trim, strip diacritics, drop punctuation/hyphens,
  collapse whitespace. Exact match = correct. Levenshtein distance 1 on words of 4+ letters = "So close!".
- **Chat limits.** Max 100 chars; max ~3 messages/second per player (drop extras).
- **Timers** live on the server; clients get `endsAt` timestamps (plus a server-time offset) and count
  down locally, so every screen shows the same time.

## 3. Drawing

- **Tools:** 12-colour palette, 3 brush sizes, eraser, fill bucket, undo, clear. Only the current drawer
  can draw (server rejects ops from anyone else).
- **Deterministic canvas:** every client draws on a fixed internal resolution (800 x 600) scaled with CSS,
  so strokes and flood fills look identical on every screen. Points are sent in internal integer
  coordinates. Pointer Events; `touch-action: none` on the canvas; no page scroll while drawing.
- **Protocol:** ops are `stroke` (colour, size, points — streamed as begin / extend in ~40 ms chunks /
  end), `fill` (x, y, colour), `undo`, `clear`. Server keeps the current turn's op list; late joiners
  and reconnects get the full op list and re-render. Cap ops per turn (e.g. 20 000 points) to stop abuse.
- **Gallery:** server stores each finished turn's `{word, drawerName, ops}` and sends them all at
  `gameOver`. Client replays them stroke-by-stroke; "Save PNG" uses `canvas.toDataURL`.

## 4. Word packs

`server/words.js`: packs Everyday, Animals, Food, Places, Actions (each at least 90 words split roughly
evenly into easy / medium / hard), Mixed = all of them. Custom: host pastes comma-separated words
(at least 10, each 2–30 chars); custom words count as "medium". Words must be drawable and family-friendly.

## 5. UI

- **Phone portrait (primary):** top bar (round x/y, timer, word or blanks), canvas full width, drawer
  toolbar under the canvas, horizontal player strip with scores, chat + guess input pinned at the bottom
  (input font-size at least 16 px so iOS doesn't zoom). Tap targets at least 44 px.
- **Desktop:** three columns — players | canvas | chat.
- **Screens:** Home (name, Create / Join, How to play), Lobby (code, QR, share link, settings for host,
  player list), Choose word, Drawing/Guessing, Reveal, Podium, Gallery.
- **Style direction (default, user may restyle later):** warm off-white "paper" background, bold dark ink
  outlines, one bright accent for primary buttons, chunky friendly headings, clear high-contrast text.
  Light and dark both readable. Small WebAudio sound effects (correct guess, tick in last 10 s, turn end)
  with a mute toggle; muted state remembered.
- **QR code:** server renders `GET /qr/:code.svg` with the `qrcode` npm package (no CDN dependency).

## 6. Tech

- Node 20+, Express, Socket.IO 4, `qrcode`. Plain HTML/CSS/JS front end with no build step.
- Layout: `server/index.js` (HTTP + socket wiring), `server/game.js` (pure room/state logic with an
  injectable clock so it's unit-testable), `server/words.js`, `public/` (index.html, app.js, canvas.js,
  style.css).
- `npm start` runs `node server/index.js`, listening on `process.env.PORT || 3000`. `GET /healthz` = 200.
- `render.yaml` blueprint: web service, runtime node, plan free, build `npm ci`, start `npm start`,
  healthCheckPath `/healthz`.
- State is in memory (a restart clears rooms — acceptable for a party game).

## 7. Testing (must pass before calling it done)

1. **Unit (node:test)** on `game.js`: scoring incl. multipliers, hint reveal schedule and the half-letters
   cap, guess normalisation + "so close", turn/round transitions, all-guessed early end, reconnect within
   60 s keeps seat + score, host migration, drawer-disconnect ends turn, mid-game join, room full.
2. **Leak test:** during choosing/drawing, assert no payload sent to any guesser socket contains the word.
3. **Integration:** scripted `socket.io-client` game with 3 players and short test timers (env overrides),
   run to `gameOver`, check final scores match the formula.
4. **E2E (Playwright):** two browser contexts (one mobile viewport) — create room, join by code *and* by
   `/r/CODE` link, draw strokes, confirm pixels appear on the other canvas, guess correctly, finish the
   game, gallery renders. Screenshot each screen at phone and desktop size and review them.

## 8. Definition of done

- All tests pass; README has "How to play", local run steps, and Render deploy steps.
- Pushed to `main` of `github.com/Mahesh7483/doodle-dash`, ready for the user to deploy on Render.
