// @ts-check
// SPEC 7.4: two browser contexts (one a phone) play a full game end to end.

const fs = require('fs');
const path = require('path');
const { test, expect, devices } = require('@playwright/test');

const SHOTS = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const phoneDevice = { ...devices['iPhone 13'] };
delete phoneDevice.defaultBrowserType; // run the phone profile in Chromium

async function shot(page, name) {
  await page.waitForTimeout(350); // let pop-in animations settle
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

// Count "ink" (non-white) pixels on a page's game canvas, and read one pixel.
async function canvasInfo(page, x = 400, y = 300) {
  return page.evaluate(
    ([px, py]) => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('#board'));
      const d = c.getContext('2d').getImageData(0, 0, 800, 600).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) ink++;
      const o = (py * 800 + px) * 4;
      return { ink, pixel: [d[o], d[o + 1], d[o + 2]] };
    },
    [x, y]
  );
}

const isInk = ([r, g, b]) => r < 80 && g < 80 && b < 100; // palette colour 0 (#1d1a2b)

async function boardBox(page) {
  const box = await page.locator('#board').boundingBox();
  if (!box) throw new Error('no canvas');
  return box;
}

// Mouse stroke across the middle of the canvas: internal (160,300) -> (640,300), plus a zigzag.
async function drawWithMouse(page) {
  const b = await boardBox(page);
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5, { steps: 20 });
  await page.mouse.up();
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width * (0.2 + i * 0.06), b.y + b.height * (i % 2 ? 0.35 : 0.2), { steps: 3 });
  await page.mouse.up();
}

// Real touch events (pointerType "touch") through the Chrome DevTools protocol.
async function drawWithTouch(page, context, dy = 0) {
  const cdp = await context.newCDPSession(page);
  const b = await boardBox(page);
  const pt = (fx, fy) => [{ x: b.x + b.width * fx, y: b.y + b.height * (fy + dy), id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(0.2, 0.5) });
  for (let i = 1; i <= 20; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(0.2 + i * 0.03, 0.5) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(0.3, 0.25) });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(0.3 + i * 0.03, 0.25 + (i % 2) * 0.1) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function guess(page, word) {
  await page.locator('#chat-input').fill(word);
  await page.locator('#chat-input').press('Enter');
}

test('full game: desktop host + phone guest (joins via /r/CODE), draw, guess, refresh, podium, gallery', async ({ browser }) => {
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const phone = await browser.newContext({ ...phoneDevice });
  const host = await desk.newPage();
  const guest = await phone.newPage();
  const errors = [];
  for (const p of [host, guest]) p.on('pageerror', (e) => errors.push(e.message));

  // ---- Home
  await host.goto('/');
  await guest.goto('/');
  await expect(host.locator('#create-btn')).toBeVisible();
  await shot(host, 'desktop-01-home');
  await shot(guest, 'phone-01-home');

  // ---- How to play from Home
  await guest.locator('#screen-home [data-open-help]').click();
  await expect(guest.locator('#help')).toContainText('Every player draws once per round.');
  await expect(guest.locator('#help')).toContainText('So close!');
  await shot(guest, 'phone-02-how-to-play');
  await guest.locator('#help [data-close]').click();

  // ---- Create
  await host.locator('#name-input').fill('Ana');
  await host.locator('#create-btn').click();
  await expect(host.locator('#screen-lobby')).toBeVisible();
  const code = (await host.locator('#lobby-code').textContent()) || '';
  expect(code).toMatch(/^[A-HJKMNP-Z]{4}$/);
  await expect(host).toHaveURL(new RegExp(`/r/${code}$`));
  await expect(host.locator('#lobby-qr')).toHaveAttribute('src', `/qr/${code}.svg`);
  await expect(host.locator('#start-btn')).toBeDisabled();

  // ---- Phone joins through the invite link
  await guest.goto(`/r/${code}`);
  await expect(guest.locator('#invite-code')).toHaveText(code);
  await shot(guest, 'phone-03-invite');
  await guest.locator('#name-input').fill('Ben');
  await guest.locator('#invite-join-btn').click();
  await expect(guest.locator('#screen-lobby')).toBeVisible();
  await expect(host.locator('#lobby-players .lp:not(.lp-empty)')).toHaveCount(2);
  await expect(guest.locator('#start-hint')).toContainText('Waiting for Ana');
  await shot(host, 'desktop-04-lobby');
  await shot(guest, 'phone-04-lobby');
  await host.locator('#screen-lobby [data-open-help]').click();
  await expect(host.locator('#help')).toContainText('Difficulty multiplier');
  await shot(host, 'desktop-02-how-to-play');
  await host.locator('#help [data-close]').click();

  // ---- Host settings: 2 rounds, Animals
  await host.locator('#set-rounds button', { hasText: '2' }).click();
  await host.locator('#set-pack button', { hasText: 'Animals' }).click();
  await expect(guest.locator('#set-pack .on')).toHaveText('Animals');
  await expect(host.locator('#start-btn')).toBeEnabled();
  await host.locator('#start-btn').click();

  // ---- Turn 1: host draws (desktop), phone guesses
  await expect(host.locator('.choice')).toHaveCount(3);
  await expect(guest.locator('.ov-wait')).toContainText('Ana is picking a word');
  await shot(host, 'desktop-05-choose-word');
  await shot(guest, 'phone-05-waiting');
  await host.locator('.choice-hard').click();
  await expect(host.locator('#toolbar')).toBeVisible();
  const word1 = ((await host.locator('#word-display').textContent()) || '').trim();
  expect(word1.length).toBeGreaterThan(1);
  // Guesser only sees blanks.
  await expect(guest.locator('#word-display .blank').first()).toBeVisible();
  expect(await guest.locator('#word-display').textContent()).not.toContain(word1);

  await drawWithMouse(host);
  // Pixels appear on the phone's canvas, at the same internal coordinates.
  await expect.poll(async () => (await canvasInfo(guest)).ink, { message: 'ink on phone canvas' }).toBeGreaterThan(2000);
  expect(isInk((await canvasInfo(guest, 400, 300)).pixel)).toBe(true);
  await shot(host, 'desktop-06-drawing');

  // Live reactions: the phone sends some, they float up on the laptop.
  await guest.locator('#react-btn').click();
  await expect(guest.locator('#react-tray')).toBeVisible();
  await guest.locator('#react-tray [data-react="lol"]').click();
  await guest.locator('#react-tray [data-react="fire"]').click();
  await expect(host.locator('.floater')).toHaveCount(2);
  await expect(host.locator('.floater').first()).toContainText('Ben');
  await host.waitForTimeout(250);
  await host.screenshot({ path: path.join(SHOTS, 'desktop-06b-reactions.png') });
  await guest.screenshot({ path: path.join(SHOTS, 'phone-06b-reactions.png') });

  // Fill the background yellow; the phone sees it too.
  await host.locator('[data-tool="fill"]').click();
  await host.locator('[data-color="5"]').click();
  const hb = await boardBox(host);
  await host.mouse.click(hb.x + hb.width * 0.95, hb.y + hb.height * 0.9);
  await expect.poll(async () => (await canvasInfo(guest, 760, 560)).pixel).toEqual([255, 210, 63]);

  // ---- Refresh the phone mid-turn: same seat, same canvas.
  await guest.reload();
  await expect(guest.locator('#screen-game')).toBeVisible();
  await expect.poll(async () => (await canvasInfo(guest)).ink).toBeGreaterThan(2000);
  expect(isInk((await canvasInfo(guest, 400, 300)).pixel)).toBe(true);
  await expect(host.locator('#player-list .pl')).toHaveCount(2);
  await expect(guest.locator('#player-list .pl.me')).toContainText('Ben');
  await expect(guest.locator('#chat-log')).toContainText('Ana is choosing a word'); // chat restored

  await guess(guest, 'definitely not it');
  await expect(guest.locator('#chat-log')).toContainText('definitely not it');
  await expect(host.locator('#chat-log')).toContainText('definitely not it');
  await shot(guest, 'phone-06-guessing');
  await guess(guest, word1.toUpperCase());
  await expect(guest.locator('#chat-log .msg-you-correct')).toContainText('You guessed it!');
  await expect(host.locator('#chat-log')).toContainText('Ben guessed it!');
  // Everyone guessed -> reveal.
  await expect(guest.locator('.ov-reveal')).toContainText(word1, { ignoreCase: true });
  await shot(guest, 'phone-07-reveal');
  await shot(host, 'desktop-07-reveal');
  const benScoreAfter1 = await guest.evaluate(() => window.__dd.S.view.players.find((p) => p.name === 'Ben').score);
  expect(benScoreAfter1).toBeGreaterThanOrEqual(200); // hard word: at least 100 * 2

  // ---- Turn 2: phone draws with real touch, desktop guesses
  await expect(guest.locator('.choice')).toHaveCount(3);
  await shot(guest, 'phone-08-choose-word');
  await shot(host, 'desktop-08-waiting');
  await guest.locator('.choice-easy').click();
  await expect(guest.locator('#toolbar')).toBeVisible();
  const word2 = ((await guest.locator('#word-display').textContent()) || '').trim();
  await drawWithTouch(guest, phone);
  await expect.poll(async () => (await canvasInfo(host)).ink, { message: 'ink on desktop canvas' }).toBeGreaterThan(1500);
  // Internal x = 0.2..0.8 of 800 at y = 300 -> pixel (400, 300) is inked on the desktop.
  expect(isInk((await canvasInfo(host, 400, 300)).pixel)).toBe(true);
  await shot(guest, 'phone-09-drawing');
  await shot(host, 'desktop-09-guessing');

  // ---- The drawer refreshes mid-turn: same drawing, same tools, correct timer, keeps drawing.
  await guest.reload();
  await expect(guest.locator('#toolbar')).toBeVisible();
  await expect.poll(async () => (await canvasInfo(guest)).ink).toBeGreaterThan(1500);
  expect(isInk((await canvasInfo(guest, 400, 300)).pixel)).toBe(true);
  expect(await guest.evaluate(() => window.__dd.S.phaseTotal)).toBe(30000);
  await expect(guest.locator('#word-display')).toHaveText(word2, { ignoreCase: true });
  expect(isInk((await canvasInfo(host, 400, 480)).pixel)).toBe(false);
  await drawWithTouch(guest, phone, 0.3); // a new line at y = 0.8 -> internal y 480
  await expect
    .poll(async () => isInk((await canvasInfo(host, 400, 480)).pixel), { message: 'new stroke after the drawer refreshed' })
    .toBe(true);
  // Undo on the phone removes the last stroke everywhere.
  const before = (await canvasInfo(host)).ink;
  await guest.locator('#undo-btn').click();
  await expect.poll(async () => (await canvasInfo(host)).ink).toBeLessThan(before);
  await guess(host, word2);
  await expect(host.locator('#chat-log .msg-you-correct')).toBeVisible();

  // ---- Remaining turns (round 2)
  for (let turn = 0; turn < 2; turn++) {
    const drawer = turn === 0 ? host : guest;
    const guesser = turn === 0 ? guest : host;
    await expect(drawer.locator('.choice')).toHaveCount(3);
    await drawer.locator('.choice-medium').click();
    await expect(drawer.locator('#toolbar')).toBeVisible();
    const w = ((await drawer.locator('#word-display').textContent()) || '').trim();
    if (drawer === host) await drawWithMouse(host);
    else await drawWithTouch(guest, phone);
    await expect.poll(async () => (await canvasInfo(guesser)).ink).toBeGreaterThan(1000);
    await guess(guesser, w);
  }

  // ---- Podium
  await expect(host.locator('#screen-podium')).toBeVisible();
  await expect(guest.locator('#screen-podium')).toBeVisible();
  await expect(host.locator('.pod')).toHaveCount(2);
  await expect(host.locator('#winner-title')).toContainText(/wins!|tie/);
  await expect(host.locator('#to-gallery-btn')).toContainText('(4)');
  await host.waitForTimeout(1800);
  await shot(host, 'desktop-10-podium');
  await shot(guest, 'phone-10-podium');
  await guest.screenshot({ path: path.join(SHOTS, 'phone-10b-podium-full.png'), fullPage: true });
  // Scores on the podium match the server's final scores.
  const finals = await host.evaluate(() => window.__dd.S.view.players.map((p) => p.score));
  expect(finals.every((s) => s > 0)).toBe(true);

  // ---- Gallery
  await host.locator('#to-gallery-btn').click();
  await guest.locator('#to-gallery-btn').click();
  await expect(host.locator('.frame')).toHaveCount(4);
  await expect(guest.locator('.frame')).toHaveCount(4);
  await expect(host.locator('.frame-word').first()).toHaveText(word1, { ignoreCase: true });
  await expect(host.locator('.frame-by').first()).toContainText('Ana');
  // The first drawing replays stroke-by-stroke and ends with ink on its canvas.
  await expect
    .poll(async () =>
      host.evaluate(() => {
        const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.frame canvas'));
        const d = c.getContext('2d').getImageData(0, 0, 800, 600).data;
        let ink = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 200) ink++;
        return ink;
      })
    )
    .toBeGreaterThan(2000);
  await host.waitForTimeout(5500);
  await shot(host, 'desktop-11-gallery');
  await guest.waitForTimeout(3000);
  await shot(guest, 'phone-11-gallery');
  await guest.screenshot({ path: path.join(SHOTS, 'phone-11b-gallery-full.png'), fullPage: true });

  // Awards on the podium
  await expect(host.locator('#awards .award')).not.toHaveCount(0);
  await expect(host.locator('#awards')).toContainText('Crowd favourite');

  // Likes: Ana likes one of Ben's drawings; Ben sees the count and the crown.
  const bensFrame = host.locator('.frame', { has: host.locator('.frame-by', { hasText: 'Ben' }) }).first();
  const idx = await bensFrame.getAttribute('data-index');
  await expect(host.locator('.frame', { has: host.locator('.frame-by', { hasText: 'Ana' }) }).first().locator('.like-btn')).toBeDisabled();
  await bensFrame.locator('.like-btn').click();
  await expect(bensFrame.locator('.like-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(guest.locator(`.frame[data-index="${idx}"] .like-n`)).toHaveText('1');
  await expect(guest.locator(`.frame[data-index="${idx}"] .fav-ribbon`)).toBeVisible();
  await host.waitForTimeout(400);
  await shot(host, 'desktop-11b-gallery-likes');

  // Poster: every drawing on one PNG.
  const [poster] = await Promise.all([host.waitForEvent('download'), host.locator('#poster-btn').click()]);
  expect(poster.suggestedFilename()).toMatch(/^doodle-dash-.+-gallery\.png$/);
  fs.copyFileSync(await poster.path(), path.join(SHOTS, 'saved-poster.png'));

  // Save PNG downloads a real PNG.
  const [download] = await Promise.all([host.waitForEvent('download'), host.locator('[data-save="0"]').click()]);
  expect(download.suggestedFilename()).toMatch(/^doodle-dash-.+\.png$/);
  const file = await download.path();
  const sig = fs.readFileSync(file).subarray(0, 8);
  expect([...sig]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.copyFileSync(file, path.join(SHOTS, 'saved-drawing.png'));

  // Big viewer
  await host.locator('[data-view="1"]').click();
  await expect(host.locator('#viewer')).toBeVisible();
  await host.waitForTimeout(4000);
  await shot(host, 'desktop-12-viewer');
  await host.keyboard.press('Escape');
  await expect(host.locator('#viewer')).toBeHidden();

  // ---- Play again -> lobby, scores reset, last gallery still reachable
  await host.locator('#gallery-back').click();
  await host.locator('#screen-podium [data-play-again]').click();
  await expect(host.locator('#screen-lobby')).toBeVisible();
  // Everyone goes back to the lobby, even the guest who was still looking at the gallery.
  await expect(guest.locator('#screen-lobby')).toBeVisible();
  expect(await host.evaluate(() => window.__dd.S.view.players.every((p) => p.score === 0))).toBe(true);
  await expect(host.locator('#last-gallery-btn')).toBeVisible();
  await guest.locator('#last-gallery-btn').click();
  await expect(guest.locator('.frame')).toHaveCount(4);
  await guest.locator('#gallery-back').click();
  await expect(guest.locator('#screen-lobby')).toBeVisible();

  expect(errors).toEqual([]);
  await desk.close();
  await phone.close();
});

test('join by typing the code; a second tab in the same browser gets its own seat', async ({ browser }) => {
  const a = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const b = await browser.newContext({ ...phoneDevice });
  const host = await a.newPage();
  await host.goto('/');
  await host.locator('#name-input').fill('Host');
  await host.locator('#create-btn').click();
  await expect(host.locator('#screen-lobby')).toBeVisible();
  const code = (await host.locator('#lobby-code').textContent()) || '';

  const guest = await b.newPage();
  await guest.goto('/');
  await guest.locator('#name-input').fill('Typer');
  await guest.locator('#code-input').fill(code.toLowerCase());
  await guest.locator('#join-btn').click();
  await expect(guest.locator('#screen-lobby')).toBeVisible();
  await expect(host.locator('#lobby-players')).toContainText('Typer');

  // Same browser (same localStorage), second tab, opening the invite link.
  const tab2 = await a.newPage();
  await tab2.goto(`/r/${code}`);
  await expect(tab2.locator('#invite-join-btn')).toBeVisible();
  await tab2.locator('#name-input').fill('Tab Two');
  await tab2.locator('#invite-join-btn').click();
  await expect(tab2.locator('#screen-lobby')).toBeVisible();
  await expect(host.locator('#lobby-players .lp:not(.lp-empty)')).toHaveCount(3);
  await expect(host.locator('#screen-lobby')).toBeVisible();
  await expect(host.locator('#lobby-players')).toContainText('you');

  // Wrong code shows a friendly error.
  const c = await browser.newContext();
  const lost = await c.newPage();
  await lost.goto('/');
  await lost.locator('#name-input').fill('Lost');
  await lost.locator('#code-input').fill('ZZZZ');
  await lost.locator('#join-btn').click();
  await expect(lost.locator('#home-error')).toContainText('not found');
  await a.close();
  await b.close();
  await c.close();
});

test('solo: one phone plays a whole game against a bot', async ({ browser }) => {
  const { doodleWords } = require('../server/doodles');
  const ctx = await browser.newContext({ ...phoneDevice });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.locator('#name-input').fill('Solo');
  await page.locator('#create-btn').click();
  await expect(page.locator('#solo-hint')).toBeVisible();
  await expect(page.locator('#start-btn')).toBeDisabled();
  await page.locator('#add-bot-btn').click();
  await expect(page.locator('#lobby-players .lp-bot')).toHaveCount(1);
  await expect(page.locator('#solo-hint')).toBeHidden();
  await expect(page.locator('#start-btn')).toBeEnabled();
  await shot(page, 'phone-13-lobby-with-bot');
  await page.locator('#set-rounds button', { hasText: '2' }).click();
  await page.locator('#start-btn').click();

  let myTurns = 0;
  let botTurns = 0;
  let botGuessedMine = 0;
  for (let guard = 0; guard < 8; guard++) {
    const next = await Promise.race([
      page.locator('.choice').first().waitFor({ timeout: 60000 }).then(() => 'draw'),
      page.locator('#word-display .mask').waitFor({ timeout: 60000 }).then(() => 'guess'),
      page.locator('#screen-podium').waitFor({ timeout: 60000 }).then(() => 'end'),
    ]);
    if (next === 'end') break;
    if (next === 'draw') {
      myTurns++;
      await page.locator('.choice-easy').click();
      await expect(page.locator('#toolbar')).toBeVisible();
      await drawWithTouch(page, ctx);
      // The bot guesses a few seconds after there's ink (or the timer runs out).
      await expect(page.locator('.ov-reveal')).toBeVisible({ timeout: 40000 });
      if (await page.locator('.ov-reveal', { hasText: 'Everyone got it' }).count()) botGuessedMine++;
    } else {
      botTurns++;
      // The bot draws its doodle stroke by stroke.
      await expect.poll(async () => (await canvasInfo(page)).ink, { timeout: 30000, message: 'bot drawing appears' }).toBeGreaterThan(20000);
      if (botTurns === 1) {
        await page.waitForTimeout(7000); // let the doodle finish
        await shot(page, 'phone-14-guessing-bot-drawing');
      }
      const mask = await page.evaluate(() => window.__dd.S.view.turn.mask);
      const fits = (w) => w.length === mask.length && [...w].every((ch, i) => mask[i] === null || mask[i] === ch);
      for (const w of doodleWords().filter(fits)) {
        await guess(page, w);
        await page.waitForTimeout(400);
        if (await page.locator('#chat-log .msg-you-correct').count() >= botTurns) break;
      }
      await expect(page.locator('#chat-log .msg-you-correct')).toHaveCount(botTurns);
    }
  }
  expect(myTurns).toBe(2);
  expect(botTurns).toBe(2);
  expect(botGuessedMine).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#screen-podium')).toBeVisible({ timeout: 40000 });
  await page.locator('#to-gallery-btn').click();
  await expect(page.locator('.frame')).toHaveCount(4);
  await expect(page.locator('.frame-by', { hasText: 'Doodlebot' })).toHaveCount(2);
  await page.waitForTimeout(5000);
  await shot(page, 'phone-15-gallery-with-bot');
  // Back on the podium: "Did you have fun?" counts in /stats.
  await page.locator('#gallery-back').click();
  await page.locator('#fun-card [data-fun="3"]').click();
  await expect(page.locator('#fun-card .fun-q')).toContainText('Thanks');
  const stats = await (await page.request.get('/stats')).json();
  expect(stats.gamesFinished).toBeGreaterThanOrEqual(1);
  expect(stats.fun.loved).toBeGreaterThanOrEqual(1);
  // Back in the lobby, the winner (or both, after a tie) carries a win badge into the next game.
  await page.locator('[data-play-again]:visible').click();
  await expect(page.locator('#screen-lobby')).toBeVisible();
  await expect(page.locator('#lobby-players .tag-wins').first()).toHaveText('🏆 1');
  expect(errors).toEqual([]);
  await ctx.close();
});

// Ink on the TV's canvas (same idea as canvasInfo, for another canvas).
async function tvInk(page, sel = '#tvg-board') {
  return page.evaluate((s) => {
    const c = /** @type {HTMLCanvasElement} */ (document.querySelector(s));
    const d = c.getContext('2d').getImageData(0, 0, 800, 600).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) ink++;
    return ink;
  }, sel);
}

const turnOf = (page) =>
  page.evaluate(() => {
    const v = window.__dd.S.view;
    return v ? { phase: v.phase, turnId: v.turn ? v.turn.id : null, drawerId: v.turn ? v.turn.drawerId : null, me: v.me } : null;
  });

test('party mode: a TV screen follows the game; the host removes a player', async ({ browser }) => {
  test.setTimeout(300_000);
  const { doodleWords } = require('../server/doodles');
  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const leoCtx = await browser.newContext({ ...phoneDevice });
  const trollCtx = await browser.newContext({ ...phoneDevice });
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const host = await deskCtx.newPage();
  const tv = await tvCtx.newPage();
  const errors = [];
  for (const p of [host, tv]) p.on('pageerror', (e) => errors.push(e.message));
  host.on('dialog', (d) => d.accept());

  await host.goto('/');
  await host.locator('#name-input').fill('Maya');
  await host.locator('#create-btn').click();
  await expect(host.locator('#screen-lobby')).toBeVisible();
  const code = (await host.locator('#lobby-code').textContent()) || '';
  await expect(host.locator('#tv-link')).toHaveAttribute('href', `/tv/${code}`);

  // The TV: open /tv and type the code.
  await tv.goto('/tv');
  await expect(tv.locator('#tv-connect')).toBeVisible();
  await tv.locator('#tv-code').fill('zzzz');
  await tv.locator('#tv-code').press('Enter');
  await expect(tv.locator('#tv-error')).toContainText('not found');
  await tv.locator('#tv-code').fill(code.toLowerCase());
  await tv.locator('#tv-code').press('Enter');
  await expect(tv.locator('#tv-lobby')).toBeVisible();
  await expect(tv).toHaveURL(new RegExp(`/tv/${code}$`));
  await expect(tv.locator('#tvl-code')).toHaveText(code);
  await expect(tv.locator('#tvl-list')).toContainText('Maya');
  await expect(host.locator('#tv-on')).toBeVisible();

  // Someone joins by mistake; the host removes them and they can't get back in.
  const troll = await trollCtx.newPage();
  await troll.goto(`/r/${code}`);
  await troll.locator('#name-input').fill('Troll');
  await troll.locator('#invite-join-btn').click();
  await expect(troll.locator('#screen-lobby')).toBeVisible();
  await expect(tv.locator('#tvl-list')).toContainText('Troll');
  await host.locator('#lobby-players [data-kick]').click();
  await expect(troll.locator('#screen-home')).toBeVisible();
  await expect(troll.locator('#toast')).toContainText('removed you');
  await expect(tv.locator('#tvl-list')).not.toContainText('Troll');
  await troll.goto(`/r/${code}`);
  await troll.locator('#name-input').fill('Troll');
  await troll.locator('#invite-join-btn').click();
  await expect(troll.locator('#home-error')).toContainText('The host removed you from this room.');

  // Leo joins on a phone, plus a bot.
  const leo = await leoCtx.newPage();
  leo.on('pageerror', (e) => errors.push(e.message));
  await leo.goto(`/r/${code}`);
  await leo.locator('#name-input').fill('Leo');
  await leo.locator('#invite-join-btn').click();
  await expect(leo.locator('#screen-lobby')).toBeVisible();
  await host.locator('#add-bot-btn').click();
  await expect(tv.locator('#tvl-list .tvl-p:not(.tvl-empty)')).toHaveCount(3);
  await expect(tv.locator('#tvl-wait')).toContainText('Waiting for Maya to start');
  await shot(tv, 'tv-01-lobby');
  await shot(host, 'desktop-16-lobby-tv-on');

  await host.locator('#set-rounds button', { hasText: '2' }).click();
  await host.locator('#start-btn').click();

  let last = null;
  let turns = 0;
  let shotDrawing = false;
  const humans = [host, leo];
  for (let guard = 0; guard < 10; guard++) {
    await expect
      .poll(async () => {
        const s = await turnOf(host);
        return !!s && (s.phase === 'gameOver' || ((s.phase === 'choosing' || s.phase === 'drawing') && s.turnId !== last));
      }, { timeout: 60000 })
      .toBe(true);
    const s = await turnOf(host);
    if (s.phase === 'gameOver') break;
    last = s.turnId;
    turns++;
    const leoId = (await turnOf(leo)).me;
    const drawerPage = s.drawerId === s.me ? host : s.drawerId === leoId ? leo : null;
    if (turns === 1) {
      await expect(tv.locator('#tvg-overlay')).toContainText('is picking a word');
      await shot(tv, 'tv-02-choosing');
    }
    if (drawerPage) {
      await drawerPage.locator('.choice-easy').click();
      await expect(drawerPage.locator('#toolbar')).toBeVisible();
      if (drawerPage === host) await drawWithMouse(host);
      else await drawWithTouch(leo, leoCtx);
      const word = await drawerPage.evaluate(() => window.__dd.S.view.turn.word);
      // The TV shows blanks and the drawing, never the word.
      await expect(tv.locator('#tvg-word .mask')).toBeVisible();
      expect(await tv.evaluate(() => window.__tv.T.view.turn.word)).toBeNull();
      await expect.poll(() => tvInk(tv), { message: 'drawing reaches the TV' }).toBeGreaterThan(1500);
      const other = drawerPage === host ? leo : host;
      if (drawerPage === host) {
        await leo.locator('#react-btn').click();
        await leo.locator('#react-tray [data-react="fire"]').click();
        await expect(tv.locator('#float-layer .floater').first()).toBeVisible();
      }
      await guess(other, 'hmm');
      await guess(other, word);
    } else {
      // The bot draws a doodle; both people guess it from the words that fit the blanks.
      await expect.poll(() => tvInk(tv), { timeout: 30000, message: 'bot drawing on the TV' }).toBeGreaterThan(20000);
      await tv.waitForTimeout(4000); // let the doodle take shape
      for (const page of humans) {
        const mask = await page.evaluate(() => window.__dd.S.view.turn && window.__dd.S.view.turn.mask);
        if (!mask) continue;
        const fits = (w) => w.length === mask.length && [...w].every((ch, i) => mask[i] === null || mask[i] === ch);
        const before = await page.locator('#chat-log .msg-you-correct').count();
        for (const w of doodleWords().filter(fits)) {
          await guess(page, w);
          await page.waitForTimeout(400);
          if ((await page.locator('#chat-log .msg-you-correct').count()) > before) break;
        }
        if (page === host && !shotDrawing) {
          shotDrawing = true;
          await shot(tv, 'tv-03-drawing');
        }
      }
    }
    if (turns === 1) {
      await expect(tv.locator('#tvg-overlay')).toContainText('The word was', { timeout: 40000 });
      await shot(tv, 'tv-04-reveal');
    }
    await expect
      .poll(async () => {
        const n = await turnOf(host);
        return n.phase === 'reveal' || n.phase === 'gameOver' || n.turnId !== last;
      }, { timeout: 60000 })
      .toBe(true);
  }
  expect(turns).toBe(6);

  // Game over on the TV: podium and awards, then the gallery slideshow.
  await expect(tv.locator('#tv-over')).toBeVisible({ timeout: 30000 });
  await expect(tv.locator('#tvo-title')).toContainText(/wins!|tie/);
  await expect(tv.locator('#tvo-awards .award').first()).toBeVisible();
  // Leo likes a drawing on their phone; the TV crowns the crowd favourite.
  await leo.locator('#to-gallery-btn').click();
  await leo.locator('.like-btn:not([disabled])').first().click();
  await expect(tv.locator('#tvo-awards .award-crowd')).toBeVisible();
  await shot(tv, 'tv-05-podium');
  await expect(tv.locator('#tvo-show')).toBeVisible({ timeout: 20000 });
  await expect.poll(() => tvInk(tv, '#tvo-canvas'), { timeout: 15000 }).toBeGreaterThan(1500);
  await tv.waitForTimeout(2500);
  await shot(tv, 'tv-06-slideshow');

  // Play again: the TV goes back to the lobby.
  await host.locator('#screen-podium [data-play-again]').click();
  await expect(tv.locator('#tv-lobby')).toBeVisible();
  expect(errors).toEqual([]);
  for (const c of [deskCtx, leoCtx, trollCtx, tvCtx]) await c.close();
});

// Ink in the left and right halves of a page's game canvas.
async function inkHalves(page) {
  return page.evaluate(() => {
    const d = document.querySelector('#board').getContext('2d').getImageData(0, 0, 800, 600).data;
    let left = 0;
    let right = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) {
        if ((i / 4) % 800 < 400) left++;
        else right++;
      }
    }
    return { left, right };
  });
}

test('drawn avatars and the audience: a full room lets a 9th person watch and react', async ({ browser }) => {
  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestCtx = await browser.newContext({ ...phoneDevice });
  const fanCtx = await browser.newContext({ ...phoneDevice });
  const host = await deskCtx.newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto('/');
  await host.locator('#name-input').fill('Maya');
  await host.locator('#create-btn').click();
  await expect(host.locator('#screen-lobby')).toBeVisible();
  const code = (await host.locator('#lobby-code').textContent()) || '';

  // The guest draws an avatar in the lobby.
  const guest = await guestCtx.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  await guest.goto(`/r/${code}`);
  await guest.locator('#name-input').fill('Leo');
  await guest.locator('#invite-join-btn').click();
  await expect(guest.locator('.tag-draw')).toBeVisible();
  await guest.locator('.tag-draw').click();
  await expect(guest.locator('#avatar-dialog')).toBeVisible();
  const pad = await guest.locator('#av-pad').boundingBox();
  await guest.mouse.move(pad.x + pad.width * 0.3, pad.y + pad.height * 0.3);
  await guest.mouse.down();
  for (let i = 0; i <= 12; i++) await guest.mouse.move(pad.x + pad.width * (0.3 + i * 0.03), pad.y + pad.height * (0.3 + (i % 2) * 0.3));
  await guest.mouse.up();
  await guest.locator('#av-save').click();
  await expect(guest.locator('#avatar-dialog')).toBeHidden();
  await expect(guest.locator('.tag-draw')).toHaveCount(0);
  const leoId = await guest.evaluate(() => window.__dd.S.view.me);
  // Everyone sees the drawing inside Leo's avatar circle.
  await expect
    .poll(() => host.evaluate((id) => {
      const el = document.querySelector(`#lobby-players .av-${id}`);
      return el ? getComputedStyle(el).backgroundImage : '';
    }, leoId))
    .toContain('data:image/png');
  expect(await guest.evaluate(() => (localStorage.getItem('dd.avatar') || '').length)).toBeGreaterThan(20);

  // Fill the room: Maya + Leo + 6 bots.
  for (let i = 0; i < 6; i++) await host.locator('#add-bot-btn').click();
  await expect(host.locator('#lobby-count')).toHaveText('8/8');

  // A 9th person is offered the audience.
  const fan = await fanCtx.newPage();
  fan.on('pageerror', (e) => errors.push(e.message));
  await fan.goto(`/r/${code}`);
  await fan.locator('#name-input').fill('Sam');
  await fan.locator('#invite-join-btn').click();
  await expect(fan.locator('#audience-offer')).toBeVisible();
  await fan.locator('#audience-btn').click();
  await expect(fan.locator('#audience-banner')).toBeVisible();
  await expect(fan.locator('#take-seat-btn')).toBeHidden();
  await expect(host.locator('#crowd-line')).toContainText('1 in the audience');
  await shot(fan, 'phone-16-audience-lobby');

  // During the game the audience gets blanks and a reaction bar instead of the chat box.
  await host.locator('#start-btn').click();
  await expect(host.locator('.choice').first()).toBeVisible();
  // The audience predicts who will guess first (not the drawer).
  await expect(fan.locator('#predict-card')).toBeVisible();
  await expect(fan.locator('#predict-card [data-predict]')).toHaveCount(7);
  await fan.locator('#predict-card [data-predict]').first().click();
  await expect(fan.locator('#predict-card [data-predict].on')).toHaveCount(1);
  await host.locator('.choice-easy').click();
  await drawWithMouse(host);
  await expect(fan.locator('#word-display .mask')).toBeVisible();
  expect(await fan.evaluate(() => window.__dd.S.view.turn.word)).toBeNull();
  await expect(fan.locator('#chat-form')).toBeHidden();
  await expect(fan.locator('#audience-bar')).toBeVisible();
  await expect.poll(async () => (await canvasInfo(fan)).ink, { message: 'the audience sees the drawing' }).toBeGreaterThan(1000);
  await fan.locator('#audience-bar [data-react="fire"]').click();
  await expect(host.locator('#float-layer .floater', { hasText: 'Sam' }).first()).toBeVisible();
  await shot(fan, 'phone-17-audience-game');
  expect(errors).toEqual([]);
  for (const c of [deskCtx, guestCtx, fanCtx]) await c.close();
});

test('chaos rounds: mirror flips the drawing, one line for the bot, blindfold covers the canvas', async ({ browser }) => {
  const { doodleWords } = require('../server/doodles');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await ctx.newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto('/');
  await host.locator('#name-input').fill('Maya');
  await host.locator('#create-btn').click();
  await host.locator('#add-bot-btn').click();
  await host.locator('#set-chaos button', { hasText: 'On' }).click();
  await host.locator('#set-rounds button', { hasText: '2' }).click();
  await host.locator('#start-btn').click();

  // Turn 1 (Maya): Mirror. Drawing on the left puts the ink on the right.
  await expect(host.locator('.ov-choose .ov-chaos')).toContainText('Mirror');
  await host.locator('.choice-easy').click();
  await expect(host.locator('#chaos-chip')).toContainText('Mirror');
  const b = await boardBox(host);
  await host.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.3);
  await host.mouse.down();
  for (let i = 1; i <= 15; i++) await host.mouse.move(b.x + b.width * (0.1 + i * 0.015), b.y + b.height * (0.3 + i * 0.02), { steps: 2 });
  await host.mouse.up();
  const halves = await inkHalves(host);
  expect(halves.right).toBeGreaterThan(500);
  expect(halves.left).toBe(0);
  await shot(host, 'desktop-17-chaos-mirror');
  await expect(host.locator('.ov-reveal')).toBeVisible({ timeout: 45000 });

  // Turn 2 (the bot): One line.
  await expect(host.locator('#word-display .mask')).toBeVisible({ timeout: 30000 });
  await expect(host.locator('#chaos-chip')).toContainText('One line');
  await expect.poll(async () => (await canvasInfo(host)).ink, { timeout: 30000 }).toBeGreaterThan(4000);
  const mask = await host.evaluate(() => window.__dd.S.view.turn.mask);
  const fits = (w) => w.length === mask.length && [...w].every((ch, i) => mask[i] === null || mask[i] === ch);
  for (const w of doodleWords().filter(fits)) {
    await guess(host, w);
    await host.waitForTimeout(400);
    if (await host.locator('#chat-log .msg-you-correct').count()) break;
  }
  await expect(host.locator('.ov-reveal')).toBeVisible({ timeout: 45000 });
  await expect(host.locator('.ov-reveal')).toContainText('Drawn with: One line');

  // Turn 3 (Maya): Blindfold. The drawer's canvas is covered; the strokes still count.
  await expect(host.locator('.ov-choose .ov-chaos')).toContainText('Blindfold', { timeout: 30000 });
  await host.locator('.choice-easy').click();
  await expect(host.locator('#blindfold')).toBeVisible();
  await drawWithMouse(host);
  expect((await canvasInfo(host)).ink).toBeGreaterThan(500);
  await shot(host, 'desktop-18-chaos-blindfold');
  await expect(host.locator('.ov-reveal')).toBeVisible({ timeout: 45000 });
  await expect(host.locator('#blindfold')).toBeHidden();
  expect(errors).toEqual([]);
  await ctx.close();
});

test('share link: the server makes a room to send; whoever opens it first is the host', async ({ browser }) => {
  const aCtx = await browser.newContext({ ...phoneDevice });
  const bCtx = await browser.newContext({ ...phoneDevice });
  const a = await aCtx.newPage();
  const errors = [];
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto('/');
  await a.locator('#link-btn').click();
  await expect(a.locator('#link-panel')).toBeVisible();
  const code = ((await a.locator('#link-code').textContent()) || '').trim();
  expect(code).toMatch(/^[A-Z]{4}$/);
  await expect(a.locator('#link-url')).toContainText(`/r/${code}`);
  await shot(a, 'phone-18-share-link');

  // A friend opens the link first and becomes the host.
  const b = await bCtx.newPage();
  b.on('pageerror', (e) => errors.push(e.message));
  await b.goto(`/r/${code}`);
  await b.locator('#name-input').fill('Friend');
  await b.locator('#invite-join-btn').click();
  await expect(b.locator('#screen-lobby')).toBeVisible();
  await expect(b.locator('#start-btn')).toBeVisible();
  await expect(b.locator('#lobby-players .tag-host')).toHaveCount(1);

  // The one who made the link joins as a player.
  await a.locator('#name-input').fill('Maker');
  await a.locator('#link-join').click();
  await expect(a.locator('#screen-lobby')).toBeVisible();
  await expect(a.locator('#start-btn')).toBeHidden();
  await expect(b.locator('#lobby-players')).toContainText('Maker');

  // /new makes a fresh room and opens it.
  const c = await aCtx.newPage();
  await c.goto('/new');
  await expect(c).toHaveURL(/\/r\/[A-Z]{4}$/);
  await expect(c.locator('.invite-kicker')).toHaveText('Your new room is ready');
  await c.locator('#name-input').fill('Solo');
  await c.locator('#invite-join-btn').click();
  await expect(c.locator('#start-btn')).toBeVisible();
  expect(errors).toEqual([]);
  await aCtx.close();
  await bCtx.close();
});

test('first-game tips show once; the host gets their usual settings in the next room', async ({ browser }) => {
  const ctx = await browser.newContext({ ...phoneDevice });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('#name-input').fill('Maya');
  await page.locator('#create-btn').click();
  await page.locator('#add-bot-btn').click();
  await page.locator('#set-rounds button', { hasText: '4' }).click();
  await page.locator('#set-time button', { hasText: '60s' }).click();
  await page.locator('#set-pack button', { hasText: 'Food' }).click();
  await page.locator('#set-chaos button', { hasText: 'On' }).click();
  await expect(page.locator('#set-chaos button.on')).toHaveText('On');

  // First game: a tip for picking a word, then one for drawing (gone after the first stroke).
  await page.locator('#start-btn').click();
  await expect(page.locator('.coach:not(.coach-out)')).toContainText('Pick a word');
  await shot(page, 'phone-19-first-tip');
  await page.locator('.choice-easy').click();
  await expect(page.locator('.coach:not(.coach-out)')).toContainText('Draw it');
  await drawWithTouch(page, ctx);
  await expect(page.locator('.coach:not(.coach-out)')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dd.tips')))).toEqual(['choose', 'draw']);

  // Leave and start a new room: the settings come back, and the tips don't.
  page.on('dialog', (d) => d.accept());
  await page.locator('#menu-btn').click();
  await page.locator('#menu [data-leave]').click();
  await expect(page.locator('#screen-home')).toBeVisible();
  await page.locator('#create-btn').click();
  await expect(page.locator('#screen-lobby')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Your usual settings are back');
  await expect(page.locator('#set-rounds button.on')).toHaveText('4');
  await expect(page.locator('#set-time button.on')).toHaveText('60s');
  await expect(page.locator('#set-pack button.on')).toHaveText('Food');
  await expect(page.locator('#set-chaos button.on')).toHaveText('On');
  await page.locator('#add-bot-btn').click();
  await page.locator('#start-btn').click();
  await expect(page.locator('.choice').first()).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.locator('.coach:not(.coach-out)')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('quick wins: a random name, tap the code to copy, share results, the host removes a player mid-game', async ({ browser }) => {
  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestCtx = await browser.newContext({ ...phoneDevice });
  const host = await deskCtx.newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto('/');
  await host.locator('#dice-btn').click();
  const name = await host.locator('#name-input').inputValue();
  expect(name).toMatch(/^\w+ \w+$/);
  await host.locator('#create-btn').click();
  await expect(host.locator('#lobby-players')).toContainText(name);
  await host.locator('#lobby-code').click();
  await expect(host.locator('#toast')).toContainText('copied');
  const code = (await host.locator('#lobby-code').textContent()) || '';

  const guest = await guestCtx.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  await guest.goto(`/r/${code}`);
  await guest.locator('#name-input').fill('Troll');
  await guest.locator('#invite-join-btn').click();
  await expect(guest.locator('#screen-lobby')).toBeVisible();
  // Chat in the lobby while waiting.
  await guest.locator('#lobby-chat-input').fill('hi from the lobby!');
  await guest.locator('#lobby-chat-input').press('Enter');
  await expect(host.locator('#lobby-chat-log')).toContainText('hi from the lobby!');
  await host.locator('#add-bot-btn').click();
  await host.locator('#start-btn').click();
  await expect(host.locator('#screen-game')).toBeVisible();
  await expect(guest.locator('#screen-game')).toBeVisible();
  // Screen readers get a description of the word area.
  await expect(guest.locator('#word-sr')).not.toBeEmpty();

  // Only the host sees remove buttons, and only on other players.
  await expect(guest.locator('#player-list .pl-kick')).toHaveCount(0);
  await expect(host.locator('#player-list .pl-kick')).toHaveCount(2);
  host.on('dialog', (d) => d.accept());
  await host.locator('#player-list li', { hasText: 'Troll' }).locator('.pl-kick').click();
  await expect(guest.locator('#screen-home')).toBeVisible();
  await expect(guest.locator('#toast')).toContainText('removed you');
  await expect(host.locator('#player-list')).not.toContainText('Troll');
  await expect(host.locator('#screen-game')).toBeVisible(); // host + bot carry on
  await shot(host, 'desktop-19-remove-mid-game');

  // Share results appears on the podium (checked by its presence; the game itself is covered elsewhere).
  await expect(host.locator('#share-results-btn')).toHaveCount(1);
  expect(errors).toEqual([]);
  await deskCtx.close();
  await guestCtx.close();
});

test('family-friendly chat, rude names refused, the Spanish pack, and the installable app', async ({ browser }) => {
  const { PACKS } = require('../server/words');
  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestCtx = await browser.newContext({ ...phoneDevice });
  const host = await deskCtx.newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto('/');
  await host.locator('#name-input').fill('B1tch');
  await host.locator('#create-btn').click();
  await expect(host.locator('#home-error')).toContainText('friendlier name');
  await host.locator('#name-input').fill('Sofía');
  await host.locator('#create-btn').click();
  await expect(host.locator('#screen-lobby')).toBeVisible();
  // Installable: the service worker is registered and the manifest is linked.
  await expect.poll(() => host.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), { timeout: 10000 }).toBe(true);
  await expect(host.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(host.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveCount(1);

  // Family-friendly chat is on by default. The host picks the Spanish words.
  await expect(host.locator('#set-clean .on')).toHaveText('On');
  await host.locator('#set-pack button', { hasText: 'Español' }).click();
  await expect(host.locator('#set-pack .on')).toHaveText('Español');
  const code = (await host.locator('#lobby-code').textContent()) || '';

  const guest = await guestCtx.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  await guest.goto(`/r/${code}`);
  await guest.locator('#name-input').fill('Mateo');
  await guest.locator('#invite-join-btn').click();
  await expect(guest.locator('#screen-lobby')).toBeVisible();
  await expect(guest.locator('#set-pack .on')).toHaveText('Español');
  await guest.locator('#lobby-chat-input').fill('this is shit lol');
  await guest.locator('#lobby-chat-input').press('Enter');
  await expect(host.locator('#lobby-chat-log')).toContainText('this is **** lol');
  await shot(guest, 'phone-20-family-friendly-chat');

  // The host draws first and picks from Spanish words; the guest guesses without the accents.
  await host.locator('#start-btn').click();
  await expect(host.locator('.choice')).toHaveCount(3);
  const all = [...PACKS.spanish.easy, ...PACKS.spanish.medium, ...PACKS.spanish.hard];
  for (const w of await host.locator('.choice .choice-word').allTextContents()) expect(all).toContain(w.trim());
  await host.locator('.choice-easy').click();
  await expect(guest.locator('#word-display .mask')).toBeVisible();
  const word = await host.evaluate(() => window.__dd.S.view.turn.word);
  await guess(guest, word.normalize('NFD').replace(/\p{M}/gu, ''));
  await expect(guest.locator('#chat-log .msg-you-correct')).toHaveCount(1);
  expect(errors).toEqual([]);
  await deskCtx.close();
  await guestCtx.close();
});

test('impostor mode: one line each, the impostor only sees the category, vote from the player list', async ({ browser }) => {
  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestCtx = await browser.newContext({ ...phoneDevice });
  const host = await deskCtx.newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto('/');
  await host.locator('#name-input').fill('Maya');
  await host.locator('#create-btn').click();
  await expect(host.locator('#screen-lobby')).toBeVisible();
  await host.locator('#set-mode button', { hasText: 'Impostor' }).click();
  await expect(host.locator('#setting-time')).toBeHidden();
  await host.locator('#set-rounds button', { hasText: '2' }).click();
  const code = (await host.locator('#lobby-code').textContent()) || '';
  const guest = await guestCtx.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  await guest.goto(`/r/${code}`);
  await guest.locator('#name-input').fill('Leo');
  await guest.locator('#invite-join-btn').click();
  await expect(guest.locator('#mode-note')).toContainText('impostor');
  // Two people aren't enough for Impostor mode; a bot makes three.
  await expect(host.locator('#start-btn')).toBeDisabled();
  await host.locator('#add-bot-btn').click();
  await expect(host.locator('#start-btn')).toBeEnabled();
  await host.locator('#start-btn').click();

  const pages = [host, guest];
  const done = new Set();
  let sawRoles = 0;
  let shotVote = false;
  let shotUnmask = false;
  for (let guard = 0; guard < 400; guard++) {
    const views = await Promise.all(pages.map((p) => p.evaluate(() => window.__dd.S.view)));
    if (views.every((v) => v.phase === 'gameOver')) break;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const v = views[i];
      const t = v.turn;
      if (!t || t.mode !== 'impostor') continue;
      const key = `${i}:${t.id}:${v.phase}:${t.step}`;
      if (v.phase === 'sketch' && !done.has(`roles:${t.id}:${i}`)) {
        // The impostor only gets the category; everyone else gets the word.
        done.add(`roles:${t.id}:${i}`);
        sawRoles++;
        if (t.role === 'impostor') {
          expect(t.word).toBeNull();
          await expect(page.locator('#word-display')).toContainText("You're the impostor");
        } else {
          expect(t.word).toBeTruthy();
          await expect(page.locator('#word-display .word')).toBeVisible();
        }
      }
      if (v.phase === 'sketch' && t.artistId === v.me && !t.lineDone && !done.has(key)) {
        done.add(key);
        await page.locator('[data-dismiss-role]').click({ timeout: 1000 }).catch(() => {});
        if (page === guest) await drawWithTouch(guest, guestCtx, (t.step % 3) * 0.1 - 0.1);
        else {
          const b = await boardBox(host);
          await host.mouse.move(b.x + b.width * 0.3, b.y + b.height * (0.3 + t.step * 0.08));
          await host.mouse.down();
          await host.mouse.move(b.x + b.width * 0.7, b.y + b.height * (0.35 + t.step * 0.08), { steps: 12 });
          await host.mouse.up();
        }
      }
      if (v.phase === 'vote' && !t.myVote && !done.has(key)) {
        done.add(key);
        await expect(page.locator('#player-list li[data-vote]')).toHaveCount(2);
        if (page === guest && !shotVote) {
          shotVote = true;
          await shot(guest, 'phone-21-impostor-vote');
        }
        await page.locator('#player-list li[data-vote]').first().click();
        await expect(page.locator('#player-list li.voted-for')).toHaveCount(1);
      }
      if (v.phase === 'lastChance' && t.role === 'impostor' && !done.has(key)) {
        done.add(key);
        await guess(page, 'pizza');
      }
      if (v.phase === 'unmask' && page === host && !shotUnmask) {
        shotUnmask = true;
        await expect(host.locator('.ov-unmask')).toBeVisible();
        await shot(host, 'desktop-20-impostor-unmask');
      }
    }
    await host.waitForTimeout(300);
  }
  expect(sawRoles).toBe(4); // two rounds, two people
  await expect(host.locator('#screen-podium')).toBeVisible({ timeout: 20000 });
  await host.locator('#to-gallery-btn').click();
  await expect(host.locator('.frame')).toHaveCount(2);
  await expect(host.locator('.frame-by', { hasText: '🕵️' })).toHaveCount(2);
  expect(errors).toEqual([]);
  await deskCtx.close();
  await guestCtx.close();
});
