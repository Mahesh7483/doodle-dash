# Doodle Dash: submission text

Copy whichever length the form asks for.

**Title:** Doodle Dash: draw it, guess it, laugh about it

**Link:** https://doodle-dash-stv7.onrender.com

**Demo video:** `docs/doodle-dash-demo.mp4` in the repo (78 s, 1080p)

**Code:** https://github.com/Mahesh7483/doodle-dash

---

## Short (about 50 words)

Doodle Dash is a drawing-and-guessing party game for 2–8 players, each on their own phone or
laptop. Create a room, share the 4-letter code or QR, and take turns drawing while everyone races
to guess. No sign-up, no install. Playing alone? Add a bot. Every drawing replays in an end-of-game
gallery.

## Long (about 200 words)

Doodle Dash is a real-time multiplayer drawing-and-guessing game built for phones first. One
player creates a room and friends join in one tap by scanning a QR code or opening a link. There's
nothing to install and no account to make.

Each turn, the drawer picks an easy, medium or hard word (harder words are worth up to twice the
points), then draws it while everyone else types guesses. Guessers see only blanks, with two
letters revealed as time runs down. Near misses get a private "So close!", and players who have
already guessed chat in a private channel so nobody can spoil the answer. Faster guesses score
more.

At the end, a podium crowns the winner and the Gallery replays every drawing of the game stroke by
stroke. Any drawing can be saved as a captioned PNG to share.

Details that make it hold up with real friends on real phones: the server keeps the timer, word
and scores, so the word never reaches a guesser's device early. Refreshing or locking your phone
puts you back in your seat with your score and the chat. And if you're alone, you can add bots
that draw and guess, so anyone can try it in under a minute.

Built with Node.js, Socket.IO and a plain HTML canvas, with automated tests covering scoring, word
leaks and full games played on a phone and a laptop.

---

## How to play (if the form asks for rules)

1. Enter a name and create a room, or join with a 4-letter code, QR or link. 2–8 players, or add bots.
2. The host picks rounds, draw time and a word pack, then starts.
3. On your turn, pick one of three words and draw it. Everyone else types guesses.
4. Guessers score 100–300 points (faster is more) times the word's difficulty (×1, ×1.5, ×2). The
   drawer scores 50 per correct guesser times the difficulty.
5. After the last round: podium, then the Gallery of every drawing.
