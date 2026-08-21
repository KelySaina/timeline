/**
 * Visual smoke test: drives the running stack in a real browser and writes screenshots so the
 * timeline can be judged by eye, not by unit test. Dev tooling — not shipped in any image.
 *
 *   node scripts/visual-check.mjs [baseUrl] [outDir]
 *
 * Uses Playwright's bundled Chromium, or the browser at $CHROME_PATH (e.g. /usr/bin/chromium)
 * when you would rather not download one.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4280';
const outDir = process.argv[3] ?? './screens';
const account = { email: 'alex@timeline.love', password: 'loveletters2024' };

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const problems = [];

async function session(name, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`[${name}] console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`[${name}] pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 500) problems.push(`[${name}] ${response.status()} ${response.url()}`);
  });
  return { context, page };
}

const shot = (page, name) => page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });

/** Drive the real store rather than the API, so the sheet and the tiles get exercised too. */
async function chooseTheme(page, theme) {
  await page.getByRole('button', { name: 'Change theme' }).click();
  await page.waitForTimeout(280);
  // Tiles are labelled "Dawn — warm paper and ember"; the em dash is what keeps
  // this from also matching the collection chip of the same name (Neon, Ink...).
  await page.getByRole('button', { name: new RegExp(`^${theme} \u2014`, 'i') }).click();
  await page.waitForTimeout(520);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

/** What the applied theme actually computes to, straight off the root element. */
const themeTokens = (page) =>
  page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return {
      classes: document.documentElement.className,
      paper: css.getPropertyValue('--paper').trim(),
      ember: css.getPropertyValue('--ember').trim(),
    };
  });

async function signIn(page) {
  await page.goto(`${base}/welcome`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/welcome'), { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
}

// --- mobile: the primary form factor -----------------------------------------------------------
{
  const { context, page } = await session('mobile', { width: 402, height: 874 });
  await page.goto(`${base}/welcome`, { waitUntil: 'networkidle' });
  await shot(page, 'mobile-1-welcome');

  await signIn(page);
  await page.waitForTimeout(900); // let the reveal animation settle
  await shot(page, 'mobile-2-timeline');

  await page.locator('article').first().click();
  await page.waitForTimeout(700);
  await shot(page, 'mobile-3-memory');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Add a memory' }).click();
  await page.waitForTimeout(600);
  await shot(page, 'mobile-4-composer');
  await page.keyboard.press('Escape');

  await page.goto(`${base}/upcoming`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await shot(page, 'mobile-5-upcoming');

  await page.goto(`${base}/us`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await shot(page, 'mobile-6-profile');
  await context.close();
}

// --- desktop, both themes ----------------------------------------------------------------------
{
  const { context, page } = await session('desktop', { width: 1280, height: 900 });
  await signIn(page);
  await page.waitForTimeout(900);
  await shot(page, 'desktop-1-timeline');

  await chooseTheme(page, 'dusk');
  await shot(page, 'desktop-2-timeline-dusk');
  await chooseTheme(page, 'dawn');

  await page.goto(`${base}/search`, { waitUntil: 'networkidle' });
  await page.locator('input[type="search"]').fill('travel');
  await page.waitForTimeout(900);
  await shot(page, 'desktop-3-search');
  await context.close();
}

// --- every theme, so a token typo in one of them cannot ship unseen ----------------------------
{
  const THEMES = [
    'dawn', 'bloom', 'linen',
    'dusk', 'ink', 'midnight',
    'peony', 'garden', 'wildflower', 'sakura',
    'sepia', 'parchment', 'heirloom', 'postcard', 'velvet',
    'neon', 'vapor', 'arcade', 'tokyo',
    'blueprint', 'brass', 'mecha',
    'starlight', 'aurora', 'nebula',
    'tide', 'ember',
  ];

  const { context, page } = await session('themes', { width: 1100, height: 820 });
  await signIn(page);
  await page.waitForTimeout(700);

  // The store in the header sheet: collections, live tiles, cinematic labels.
  await page.getByRole('button', { name: 'Change theme' }).click();
  await page.waitForTimeout(420);
  await shot(page, 'theme-store-sheet');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(320);

  // And the full store on Us, where it lives.
  await page.getByRole('link', { name: /Us/ }).first().click();
  await page.waitForTimeout(700);
  await shot(page, 'theme-store-profile');
  await page.getByRole('link', { name: /Story/ }).first().click();
  await page.waitForTimeout(500);

  // A theme with no CSS block would silently inherit dawn's tokens, so the run
  // fails if two themes compute to the same paper+accent pair.
  const seen = new Map();
  for (const theme of THEMES) {
    await chooseTheme(page, theme);
    await shot(page, `theme-${theme}`);

    const tokens = await themeTokens(page);
    if (!tokens.classes.includes(`theme-${theme}`)) {
      problems.push(`[themes] ${theme} was never applied (classes: ${tokens.classes})`);
    }
    const fingerprint = `${tokens.paper}|${tokens.ember}`;
    if (seen.has(fingerprint)) {
      problems.push(`[themes] ${theme} computes identically to ${seen.get(fingerprint)} — missing a CSS block?`);
    }
    seen.set(fingerprint, theme);
  }
  console.log(`  ${seen.size} distinct themes rendered`);

  // Leave the demo couple where it started, so screenshots stay comparable run to run.
  await chooseTheme(page, 'dawn');
  await context.close();
}

// --- first run: onboarding and the empty state -------------------------------------------------
{
  const { context, page } = await session('first-run', { width: 402, height: 874 });
  const stamp = (process.hrtime.bigint() % 100000000n).toString(36);
  await page.goto(`${base}/welcome`, { waitUntil: 'networkidle' });
  await page.locator('#name').fill('Robin');
  await page.locator('#email').fill(`visual-${stamp}@test.local`);
  await page.locator('#password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Start our timeline' }).click();
  await page.waitForURL(/\/start/, { timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(page, 'first-1-onboarding');

  await page.locator('#couple-title').fill('Robin & Sam');
  await page.locator('#started').fill('2026-02-14');
  await page.getByRole('button', { name: 'Create our timeline' }).click();
  await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
  await page.waitForTimeout(900);
  await shot(page, 'first-2-empty-state');

  await page.getByRole('button', { name: /How we met/ }).click();
  await page.waitForTimeout(600);
  await shot(page, 'first-3-quick-start');

  // And the whole point: adding one memory turns the empty state into a story.
  await page.getByRole('button', { name: 'Add to our story' }).click();
  await page.waitForTimeout(1400);
  await shot(page, 'first-4-after-first-memory');
  const cards = await page.locator('article').count();
  if (cards < 1) problems.push('[first-run] the first memory did not appear on the timeline');
  await context.close();
}

await browser.close();

if (problems.length) {
  console.error(`Visual check found ${problems.length} problem(s):`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`Visual check clean. Screenshots in ${outDir}`);
