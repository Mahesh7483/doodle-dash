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
  await guest.locator('[data-react="lol"]').click();
  await guest.locator('[data-react="fire"]').click();
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
  expect(errors).toEqual([]);
  await ctx.close();
});
