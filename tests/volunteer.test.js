/*
 * Walks the interview sign-up (volunteer.html) in a headless browser with made-up details, then checks what the page
 * would send and how volunteer-receiver.gs turns it into a row. Nothing leaves the machine.
 *
 *   cd tests && npm install && node volunteer.test.js
 */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const receiver = require("../volunteer-receiver.gs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "volunteer.html"), "utf8");
const SURVEY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const FAKE_ENDPOINT = "https://script.google.com/macros/s/TEST/exec";
assert.ok(HTML.includes('var OPEN = false;'), "volunteer.html must declare var OPEN = false;");
assert.ok(HTML.includes('var ENDPOINT = "'), "volunteer.html must declare ENDPOINT");
/* The receiver's URL goes in once it is deployed; the tests put a made-up one in either way. */
const withEndpoint = h => h.replace(/var ENDPOINT = "[^"]*";/, 'var ENDPOINT = "' + FAKE_ENDPOINT + '";');
const CLOSED = withEndpoint(HTML);
const OPENED = CLOSED.replace("var OPEN = false;", "var OPEN = true;");
const PROD = "https://project-campus-vsurvey.vercel.app/";
const PREVIEW = "https://istorya-preview.example/";
const EXE = process.env.CHROMIUM || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const PHONE = { width: 360, height: 640 };
const DESKTOP = { width: 1366, height: 768 };

let passed = 0, failed = 0;
async function check(name, fn) {
  if (process.env.ONLY && name.indexOf(process.env.ONLY) < 0) return;
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String((e && e.stack) || e).split("\n").slice(0, 10).join("\n     ")); }
}
async function open(browser, o = {}) {
  const mobile = !!o.mobile;
  const ctx = await browser.newContext({ viewport: mobile ? PHONE : DESKTOP, hasTouch: mobile, isMobile: mobile, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const posts = [], errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route("**/*", route => {
    const req = route.request(), u = req.url();
    if (u.startsWith(PROD) || u.startsWith(PREVIEW)) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: o.html || OPENED });
    if (u.startsWith("https://script.google.com/")) { posts.push(req.postData()); return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); }
    return route.abort();
  });
  await page.goto((o.host || PROD) + "volunteer.html" + (o.query || ""));
  return { ctx, page, posts, errors };
}
const current = page => page.evaluate(() => window.__volunteer.current());
async function at(page, id) {
  await page.waitForFunction(x => window.__volunteer.current() === x, id, { timeout: 5000 });
  await page.waitForTimeout(80);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, id + " is wider than the screen by " + over + "px");
}
/* A locked Next still answers a tap, with a nudge, so the tests press it even when it says it is disabled. */
async function next(page, locked) { await page.click("#next", locked ? { force: true } : {}); }
async function send(page) {
  if (await page.locator("#send").isVisible()) return page.click("#send");
  assert.strictEqual(await page.locator("#next-lbl").textContent(), "Send", "the bottom bar offers Send on a phone");
  return page.click("#next");
}
async function pick(page, label) { await page.click('.chip[data-v="' + label.replace(/"/g, '\\"') + '"]'); }
/* A full walk, answering everything; returns the parsed record that was posted. */
async function walk(page, o = {}) {
  await at(page, "intro"); await page.click("#start");
  await at(page, "consent"); await page.click("#agree"); await next(page);
  await at(page, "name"); await page.fill("#field", "Ana"); await next(page);
  await at(page, "contact"); await page.fill("#field", "0917 000 0000"); await next(page);
  await at(page, "year"); await pick(page, "2nd"); if (o.reduced) await next(page);
  await at(page, "faculty"); await pick(page, "Computing"); if (o.reduced) await next(page);
  await at(page, "residence"); await pick(page, "An on-campus dorm"); if (o.reduced) await next(page);
  await at(page, "org"); await pick(page, "An active member"); if (o.reduced) await next(page);
  await at(page, "free"); await pick(page, "Weekday evenings"); await pick(page, "Weekends"); await next(page);
  await at(page, "send"); await send(page);
  await at(page, "done");
}

(async () => {
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});

  for (const mobile of [true, false]) {
    await check("a full sign-up sends one record the receiver accepts (" + (mobile ? "phone" : "computer") + ")", async () => {
      const { ctx, page, posts, errors } = await open(browser, { mobile });
      await walk(page);
      await page.waitForTimeout(200);
      assert.strictEqual(posts.length, 1, "one record is sent");
      const r = JSON.parse(posts[0]);
      assert.strictEqual(receiver.refusal_(r), "", "the receiver accepts it");
      assert.deepStrictEqual({ name: r.name, contact: r.contact, year: r.year, faculty: r.faculty, residence: r.residence, org: r.org, free: r.free, test: r.test },
        { name: "Ana", contact: "0917 000 0000", year: "2nd", faculty: "Computing", residence: "An on-campus dorm", org: "An active member", free: ["Weekday evenings", "Weekends"], test: false });
      const row = receiver.row_(r, new Date("2026-10-25T00:00:00Z"));
      assert.strictEqual(row.length, receiver.headers_().length, "the row fits the header");
      assert.strictEqual(row[receiver.headers_().indexOf("free")], "Weekday evenings, Weekends");
      assert.strictEqual(row[receiver.headers_().indexOf("deleteBy")], "2027-01-23", "deleted three months after signing up");
      /* Only the day is kept, so a sign-up can't be matched to the survey answer sent seconds before it (D-143). */
      assert.strictEqual(row[receiver.headers_().indexOf("signedUpOn")], "2026-10-25");
      assert.ok(row.every(c => !/T\d\d:\d\d/.test(String(c))), "no time of day anywhere in the row");
      assert.strictEqual(receiver.day_(new Date("2026-10-25T17:30:00Z")), "2026-10-26", "the day is the Philippines' day");
      /* Nothing in the record could tie it to a survey answer. */
      const keys = Object.keys(r).sort();
      assert.deepStrictEqual(keys, ["age18", "consent", "contact", "faculty", "form", "free", "name", "org", "residence", "test", "version", "year"]);
      assert.ok(/I'll message you/.test(await page.textContent("#panel")), "the thank-you says what happens next");
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    });
  }

  await check("the consent, a name, and a contact are needed; everything else can be skipped", async () => {
    const { ctx, page, posts } = await open(browser, { mobile: true });
    await page.click("#start"); await at(page, "consent");
    await next(page, true); assert.strictEqual(await current(page), "consent", "Next waits for the agreement");
    await page.click("#agree"); await next(page);
    await at(page, "name"); await next(page, true);
    assert.strictEqual(await current(page), "name", "Next waits for a name");
    assert.ok(await page.locator("#need").isVisible(), "it says why");
    await page.fill("#field", "   "); await next(page, true);
    assert.strictEqual(await current(page), "name", "spaces are not a name");
    await page.fill("#field", "Ana"); await page.press("#field", "Enter");
    await at(page, "contact"); await page.fill("#field", "ana@example.com"); await next(page);
    for (const id of ["year", "faculty", "residence", "org", "free"]) {
      await at(page, id);
      assert.strictEqual(await page.textContent("#next-lbl"), "Skip", id + " offers Skip");
      await next(page);
    }
    await at(page, "send");
    assert.strictEqual((await page.locator(".slip dd.empty").allTextContents()).filter(t => t === "Skipped").length, 5);
    await send(page); await at(page, "done");
    await page.waitForTimeout(200);
    const r = JSON.parse(posts[0]);
    assert.strictEqual(receiver.refusal_(r), "");
    assert.deepStrictEqual([r.year, r.faculty, r.residence, r.org, r.free], [null, null, null, null, []]);
    await ctx.close();
  });

  await check("the Send screen's Edit goes back to that question, and the change is sent", async () => {
    const { ctx, page, posts } = await open(browser, {});
    await page.click("#start"); await page.click("#agree"); await next(page);
    await page.fill("#field", "Ana"); await next(page);
    await page.fill("#field", "0917"); await next(page);
    for (let i = 0; i < 5; i++) await next(page);
    await at(page, "send");
    await page.click('[data-edit="contact"]'); await at(page, "contact");
    assert.strictEqual(await page.inputValue("#field"), "0917", "the answer is still there");
    await page.fill("#field", "0917 000 0000");
    for (let i = 0; i < 6; i++) await next(page);
    await at(page, "send"); await send(page); await at(page, "done");
    await page.waitForTimeout(200);
    assert.strictEqual(JSON.parse(posts[0]).contact, "0917 000 0000");
    await ctx.close();
  });

  await check("nothing is sent while OPEN is false, except ?test=1 sign-ups, which are marked", async () => {
    let o = await open(browser, { html: CLOSED });
    assert.strictEqual(await o.page.textContent("#flag"), "Not open yet: nothing is sent");
    await walk(o.page); await o.page.waitForTimeout(200);
    assert.strictEqual(o.posts.length, 0, "a closed page sends nothing");
    assert.ok(/preview, so nothing was sent/.test(await o.page.textContent("#panel")), "and says so");
    await o.ctx.close();
    o = await open(browser, { html: CLOSED, query: "?test=1" });
    assert.strictEqual(await o.page.textContent("#flag"), "Test mode: this sign-up is marked as a test");
    await walk(o.page); await o.page.waitForTimeout(200);
    assert.strictEqual(o.posts.length, 1);
    const r = JSON.parse(o.posts[0]);
    assert.strictEqual(r.test, true);
    assert.strictEqual(receiver.row_(r, new Date("2026-10-25T00:00:00Z"))[1], "2026-10-26", "test rows are deleted a day later");
    await o.ctx.close();
  });

  await check("previews and a page without the receiver's address send nothing", async () => {
    let o = await open(browser, { host: PREVIEW });
    assert.strictEqual(await o.page.textContent("#flag"), "Preview: nothing is sent");
    await walk(o.page); await o.page.waitForTimeout(200);
    assert.strictEqual(o.posts.length, 0);
    await o.ctx.close();
    o = await open(browser, { html: HTML.replace("var OPEN = false;", "var OPEN = true;") });
    await walk(o.page); await o.page.waitForTimeout(200);
    assert.strictEqual(o.posts.length, 0, "an empty ENDPOINT sends nothing");
    await o.ctx.close();
  });

  await check("with reduced motion on, nothing moves on by itself", async () => {
    const { ctx, page, posts } = await open(browser, { reduced: true, mobile: true });
    await page.click("#start"); await page.click("#agree"); await next(page);
    await page.fill("#field", "Ana"); await next(page); await page.fill("#field", "0917"); await next(page);
    await at(page, "year"); await pick(page, "3rd"); await page.waitForTimeout(900);
    assert.strictEqual(await current(page), "year", "picking an answer doesn't move on");
    assert.strictEqual(await page.textContent("#next-lbl"), "Next");
    await ctx.close();
  });

  await check("the page's answers match the receiver's lists, and the survey's", async () => {
    const { ctx, page } = await open(browser, { reduced: true });
    await page.click("#start"); await page.click("#agree"); await next(page);
    await page.fill("#field", "Ana"); await next(page); await page.fill("#field", "0917"); await next(page);
    for (const [id, list] of [["year", receiver.YEARS], ["faculty", receiver.FACULTIES], ["residence", receiver.RESIDENCE], ["org", receiver.ORG], ["free", receiver.FREE]]) {
      await at(page, id);
      assert.deepStrictEqual(await page.$$eval(".chip", cs => cs.map(c => c.dataset.v)), list, id);
      await next(page);
    }
    for (const o of receiver.RESIDENCE.concat(receiver.ORG)) assert.ok(SURVEY.includes(JSON.stringify(o).slice(1, -1).replace(/\\'/g, "'")), "the survey offers " + o);
    for (const f of receiver.FACULTIES) assert.ok(SURVEY.includes('"' + f + '"'), "the survey lists the faculty " + f);
    await ctx.close();
  });

  await check("the survey's last screen leads to this page, never the old Google Form", async () => {
    assert.ok(/var VOLUNTEER_URL = "volunteer\.html";/.test(SURVEY));
    assert.ok(!/docs\.google\.com\/forms/.test(SURVEY), "no Google Form link in the survey");
    assert.ok(!/FormApp/.test(fs.readFileSync(path.join(__dirname, "..", "survey-receiver.gs"), "utf8")), "the survey's receiver no longer builds a form");
  });

  await check("a new sign-up goes at a random place among the rows, never only at the bottom", async () => {
    assert.strictEqual(receiver.slot_(1, 0.99), 1, "the first sign-up goes under the header");
    const seen = new Set();
    for (let i = 0; i < 50; i++) { const s = receiver.slot_(5, i / 50); assert.ok(s >= 1 && s <= 5); seen.add(s); }
    assert.strictEqual(seen.size, 5, "any place from under the header to the bottom");
  });

  await check("the receiver keeps formulas out, refuses records without consent, and deletes what D-111 says", async () => {
    assert.strictEqual(receiver.cell_("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.strictEqual(receiver.cell_("+639170000000"), "'+639170000000");
    const ok = { form: "volunteer", version: "v1", consent: true, age18: true, name: "Ana", contact: "0917" };
    assert.strictEqual(receiver.refusal_(ok), "");
    assert.strictEqual(receiver.refusal_({ ...ok, consent: false }), "no consent");
    assert.strictEqual(receiver.refusal_({ ...ok, contact: "" }), "no contact");
    assert.strictEqual(receiver.refusal_({ ...ok, form: undefined, variant: "since" }), "not a sign-up", "a survey record never lands in the sign-up sheet");
    const H = receiver.headers_(), now = new Date("2026-10-25T00:00:00Z");
    const row = (d, test, done) => { const a = H.map(() => ""); a[H.indexOf("signedUpOn")] = d; a[H.indexOf("test")] = test; a[H.indexOf("interviewDone")] = done; return a; };
    const rows = [H, row("2026-10-24", false, false), row("2026-07-20", false, false), row("2026-10-25", true, false),
      row("2026-10-24", true, false), row("2026-10-20", false, true)];
    assert.deepStrictEqual(receiver.expired_(rows, now), [6, 5, 3], "interviewed, a day-old test, and three months old; bottom first");
  });

  await browser.close();
  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
