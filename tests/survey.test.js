/*
 * Walks Istorya sa VSU in a headless browser with made-up answers, then checks
 * what the page would send and how the receiver script turns it into a row.
 * Nothing leaves the machine: the page and the receiver's address are both
 * answered by the test itself.
 *
 *   cd tests && npm install && npm test
 *
 * Set SHOTS=<folder> to save a screenshot of every step.
 */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const receiver = require("../survey-receiver.gs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
/* The page ships closed (OPEN = false) until VSU's permission is in hand; most tests open it. */
const HTML_OPEN = HTML.replace("var OPEN = false;", "var OPEN = true;");
assert.notStrictEqual(HTML_OPEN, HTML, "index.html must declare var OPEN = false;");
const PROD = "https://istorya-sa-vsu.vercel.app/";
const PREVIEW = "https://istorya-preview.example/";
const SHOTS = process.env.SHOTS || "";
const EXE = process.env.CHROMIUM || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const PHONE = { width: 360, height: 640 };
const DESKTOP = { width: 1366, height: 768 };

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String((e && e.stack) || e).split("\n").slice(0, 4).join("\n     ")); }
}

async function open(browser, o = {}) {
  const mobile = !!o.mobile;
  const ctx = await browser.newContext({ viewport: o.viewport || (mobile ? PHONE : DESKTOP), hasTouch: mobile, isMobile: mobile, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const posts = [], errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route("**/*", route => {
    const req = route.request(), u = req.url();
    if (u.startsWith(PROD) || u.startsWith(PREVIEW)) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: o.closed ? HTML : HTML_OPEN });
    if (u.startsWith("https://script.google.com/")) { posts.push(req.postData()); return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); }
    return route.abort();
  });
  await page.goto((o.host || PROD) + (o.query || ""));
  return { ctx, page, posts, errors };
}

const current = page => page.evaluate(() => window.__survey.current());
async function at(page, id, shot) {
  await page.waitForFunction(x => window.__survey.current() === x, id, { timeout: 8000 });
  await page.waitForTimeout(420);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, "step " + id + " is wider than the screen by " + over + "px");
  if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot + "-" + id + ".png") });
}
const inStep = (id, sel) => '[data-step="' + id + '"] ' + sel;
const btn = (id, v) => inStep(id, '[data-v="' + v.replace(/"/g, '\\"') + '"]');
async function next(page) { await page.click("#next"); }

const PLAN = {
  a: ["Several times", "Moderate"], b: ["Often", "Serious"], n: ["Once or twice", "Minor"], c: ["Never"], d: ["Does not apply"],
  o: ["Several times", "Serious"], e: ["Often", "Moderate"], f: ["Never"], g: ["Once or twice", "Not a problem"], h: ["Does not apply"],
  i: ["Several times", "Moderate"], j: ["Never"], k: ["Once or twice", "Minor"], l: ["Never"], m: ["Often", "Serious"]
};

async function walkAll(page, shot) {
  await at(page, "intro", shot);
  await page.click("#start");
  await at(page, "consent", shot);
  await page.click(inStep("consent", ".agree"));
  await at(page, "home", shot);
  await page.click(btn("home", "A boarding house or apartment near campus"));
  await at(page, "year", shot);
  await page.click(btn("year", "2nd"));
  await at(page, "faculty", shot);
  await page.click(btn("faculty", "Faculty of Engineering"));
  await at(page, "org", shot);
  await page.click(btn("org", "A member"));
  await at(page, "scholarship", shot);
  await page.click(btn("scholarship", "No"));
  await at(page, "firstGen", shot);
  await page.click(btn("firstGen", "Yes"));
  if (SHOTS && shot) { await page.waitForTimeout(1700); await page.screenshot({ path: path.join(SHOTS, shot + "-firstGen-printed.png") }); }
  await at(page, "sources", shot);
  await page.click(btn("sources", "Messenger group chats"));
  await page.click(btn("sources", "Official VSU Facebook pages"));
  await page.click(btn("sources", "Other"));
  await page.fill(inStep("sources", '[data-other="sourcesOther"]'), "Our class adviser");
  await next(page);
  await at(page, "mainSource", shot);
  await page.click(btn("mainSource", "Messenger group chats"));
  await at(page, "dataSpend", shot);
  await page.click(btn("dataSpend", "₱50 to ₱99"));
  await at(page, "dataSchool", shot);
  await page.click(btn("dataSchool", "About half"));
  await at(page, "online", shot);
  await page.click(btn("online", "Both"));
  await at(page, "scenario", shot);
  await page.click(btn("scenario", "Asked in a student Facebook group"));
  const order = (await page.evaluate(() => window.__survey.steps())).filter(id => id.indexOf("m-") === 0);
  for (const id of order) {
    await at(page, id, shot);
    const k = id.slice(2), plan = PLAN[k];
    await page.click(inStep(id, '[data-key="often:' + k + '"] [data-v="' + plan[0] + '"]'));
    if (plan[1]) await page.click(inStep(id, '[data-key="matters:' + k + '"] [data-v="' + plan[1] + '"]'));
  }
  await at(page, "map", shot);
  const box = await page.locator("#map").boundingBox();
  await page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.30);
  await page.click(btn("map", "Hard to find"));
  await page.mouse.click(box.x + box.width * 0.70, box.y + box.height * 0.72);
  await page.click(btn("map", "Closed, or no one there"));
  await page.click(inStep("map", '[data-key="area"] [data-v="0"]'));
  if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot + "-map-pins.png") });
  await next(page);
  await at(page, "coins", shot);
  const jars = page.locator("#jars .jarhit");
  for (let i = 0; i < 4; i++) await jars.nth(0).click();
  for (let i = 0; i < 3; i++) await jars.nth(1).click();
  await page.locator("#jars .minus").nth(1).click();
  if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot + "-coins-spent.png") });
  await next(page);
  await at(page, "story", shot);
  await page.fill("#story", "I went to three offices before someone told me where to file my clearance.");
  await page.click(inStep("story", ".toggle"));
  await next(page);
  await at(page, "trust", shot);
  await page.click(btn("trust", "4"));
  await at(page, "postedAnonymously", shot);
  await page.click(btn("postedAnonymously", "Yes"));
  await at(page, "wouldUse", shot);
  await page.click(btn("wouldUse", "Notices and deadlines in one place"));
  await page.click(btn("wouldUse", "Questions about my subjects"));
  await next(page);
  await at(page, "postPreference", shot);
  await page.click(btn("postPreference", "Under a made-up name other members can't link to me"));
  await at(page, "keepAway", shot);
  await page.click(btn("keepAway", "Uses too much mobile data"));
  await next(page);
  await at(page, "send", shot);
  await page.fill("#comment", "Will the results be shared with students?");
  await page.click("#send");
  await at(page, "final", shot);
}

function rowOf(r) {
  const h = receiver.headers_(), row = receiver.row_(r, new Date());
  assert.strictEqual(row.length, h.length, "the row and the header row differ in length");
  const o = {};
  h.forEach((k, i) => { o[k] = row[i]; });
  return o;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  for (const [label, mobile] of [["phone", true], ["desktop", false]]) {
    await check("a full walk on " + label + " sends one complete record", async () => {
      const t = await open(browser, { mobile });
      await walkAll(t.page, SHOTS ? label : "");
      await t.page.waitForTimeout(300);
      assert.deepStrictEqual(t.errors, []);
      assert.strictEqual(t.posts.length, 1, "expected one POST, got " + t.posts.length);
      const r = JSON.parse(t.posts[0]);
      assert.strictEqual(r.version, "scenes-v2");
      assert.strictEqual(r.consent, true);
      assert.strictEqual(r.age18, true);
      assert.strictEqual(r.test, false);
      assert.ok(r.startedAt && r.sentAt && r.startedAt <= r.sentAt, "startedAt and sentAt");
      for (const k of ["birthYear", "birthMonth", "decade", "month", "year_of_birth"]) assert.ok(!(k in r), "the record must not carry " + k);
      assert.ok(!/\b(19|20)\d\d-\d\d-\d\d\b/.test(JSON.stringify(Object.assign({}, r, { startedAt: "", sentAt: "" }))), "no dates beyond the timestamps");
      assert.strictEqual(r.residence, "A boarding house or apartment near campus");
      assert.strictEqual(r.faculty, "Faculty of Engineering");
      assert.strictEqual(r.firstGen, "Yes");
      assert.deepStrictEqual(r.sources, ["Messenger group chats", "Official VSU Facebook pages", "Other"]);
      assert.strictEqual(r.sourcesOther, "Our class adviser");
      assert.strictEqual(r.mainSource, "Messenger group chats");
      assert.strictEqual(r.dataSpend, "₱50 to ₱99");
      assert.strictEqual(r.dataSchool, "About half");
      assert.strictEqual(r.online, "Both");
      assert.strictEqual(Object.keys(r.board).length, 15);
      assert.deepStrictEqual(r.board.b, { often: "Often", matters: "Serious" });
      assert.deepStrictEqual(r.board.c, { often: "Never", matters: null });
      assert.strictEqual(r.pins.length, 3);
      assert.strictEqual(r.pins[0].why, "Hard to find");
      assert.strictEqual(r.pins[1].why, "Closed, or no one there");
      assert.strictEqual(r.pins[2].near, "upper campus");
      const coinTotal = Object.values(r.coins).reduce((a, b) => a + b, 0);
      assert.strictEqual(coinTotal, 6);
      assert.strictEqual(r.mayQuote, true);
      assert.strictEqual(r.trust, 4);
      assert.strictEqual(r.postPreference, "Under a made-up name other members can't link to me");
      assert.deepStrictEqual(r.keepAway, ["Uses too much mobile data"]);
      assert.strictEqual(r.comment, "Will the results be shared with students?");
      const row = rowOf(r);
      assert.strictEqual(row.faculty, "Faculty of Engineering");
      assert.strictEqual(row["uses: Other"], true);
      assert.strictEqual(row["uses: other text"], "Our class adviser");
      assert.strictEqual(row["uses: unlisted"], "");
      assert.strictEqual(row["wouldUse: Questions about my subjects"], true);
      assert.strictEqual(row["wouldUse: unlisted"], "");
      assert.strictEqual(row["away: unlisted"], "");
      assert.strictEqual(row["n often"], "Once or twice");
      assert.strictEqual(row["o matters"], "Serious");
      assert.strictEqual(row["pin1 why"], "Hard to find");
      assert.strictEqual(row.age18, true);
      assert.strictEqual(row.test, false);
      assert.strictEqual(row.comment, "Will the results be shared with students?");
      assert.strictEqual(receiver.refusal_(r), "");
      await t.ctx.close();
    });
  }

  await check("every option on the page is one the receiver knows", async () => {
    const t = await open(browser, {});
    const vals = await t.page.evaluate(() => {
      const get = (step, key) => Array.from(document.querySelectorAll('[data-step="' + step + '"] [data-key="' + key + '"] [data-v]')).map(b => b.dataset.v);
      return { sources: get("sources", "sources"), pull: get("wouldUse", "wouldUse"), away: get("keepAway", "keepAway"), moments: window.__survey.steps().filter(id => id.indexOf("m-") === 0).map(id => id.slice(2)) };
    });
    assert.deepStrictEqual(vals.sources.slice().sort(), receiver.SOURCES.slice().sort());
    assert.deepStrictEqual(vals.pull.slice().sort(), receiver.WOULD_USE.slice().sort());
    assert.deepStrictEqual(vals.away.slice().sort(), receiver.AWAY.slice().sort());
    assert.deepStrictEqual(vals.moments.slice().sort(), receiver.MOMENTS.slice().sort());
    await t.ctx.close();
  });

  await check("skipping every question still sends a valid record", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    for (let i = 0; i < 60 && (await current(t.page)) !== "send"; i++) {
      const before = await current(t.page);
      assert.strictEqual(await t.page.locator("#next-lbl").textContent(), "Skip", "the button says Skip on an unanswered step (" + before + ")");
      await next(t.page);
      await t.page.waitForFunction(x => window.__survey.current() !== x, before, { timeout: 4000 });
    }
    await at(t.page, "send");
    assert.ok((await t.page.locator("#skipped").textContent()).indexOf("You skipped") === 0);
    await t.page.click("#send");
    await at(t.page, "final");
    const r = JSON.parse(t.posts[0]);
    assert.strictEqual(r.residence, null);
    assert.deepStrictEqual(r.board, {});
    assert.deepStrictEqual(r.pins, []);
    assert.strictEqual(r.mainSource, null);
    assert.strictEqual(receiver.refusal_(r), "");
    assert.deepStrictEqual(t.errors, []);
    await t.ctx.close();
  });

  for (const vp of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 360, height: 640 }, { width: 390, height: 844 }]) {
    await check("the Start button is in view without scrolling at " + vp.width + "x" + vp.height, async () => {
      const t = await open(browser, { viewport: vp, mobile: vp.width < 700 });
      const r = await t.page.evaluate(() => { const b = document.getElementById("start").getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight }; });
      assert.ok(r.top >= 0 && r.bottom <= r.h, JSON.stringify(r));
      await t.ctx.close();
    });
  }

  await check("a preview address sends nothing and shows the record instead", async () => {
    const t = await open(browser, { host: PREVIEW });
    assert.strictEqual(await t.page.evaluate(() => window.__survey.live), false);
    assert.ok((await t.page.locator("#flag").textContent()).indexOf("Preview") === 0);
    assert.strictEqual(await t.page.locator("#h-intro").textContent(), "VSUrvey");
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    await t.page.evaluate(() => window.__survey.go("send"));
    await at(t.page, "send");
    await t.page.click("#send");
    await at(t.page, "final");
    assert.strictEqual(t.posts.length, 0);
    assert.ok(await t.page.locator("#payload").isVisible());
    await t.ctx.close();
  });

  await check("as shipped, the live address sends nothing until the survey is opened", async () => {
    const t = await open(browser, { closed: true });
    assert.strictEqual(await t.page.evaluate(() => window.__survey.live), false);
    assert.ok((await t.page.locator("#flag").textContent()).indexOf("Not open yet") === 0);
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    await t.page.evaluate(() => window.__survey.go("send"));
    await at(t.page, "send");
    await t.page.click("#send");
    await at(t.page, "final");
    assert.strictEqual(t.posts.length, 0);
    await t.ctx.close();
  });

  await check("?test=1 sends a record marked as a test, even before the survey opens", async () => {
    const t = await open(browser, { query: "?test=1", closed: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    await t.page.evaluate(() => window.__survey.go("send"));
    await at(t.page, "send");
    await t.page.click("#send");
    await at(t.page, "final");
    const r = JSON.parse(t.posts[0]);
    assert.strictEqual(r.test, true);
    assert.strictEqual(rowOf(r).test, true);
    await t.ctx.close();
  });

  await check("arrow keys move between steps, and the parts menu jumps", async () => {
    const t = await open(browser, {});
    await t.page.click("#start");
    await at(t.page, "consent");
    assert.ok(await t.page.locator("#chap").isDisabled(), "the menu stays shut before consent");
    await t.page.keyboard.press("Tab");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    await t.page.keyboard.press("ArrowRight");
    await at(t.page, "year");
    await t.page.keyboard.press("ArrowLeft");
    await at(t.page, "home");
    await t.page.click("#chap");
    await t.page.click('#menu [data-jump="map"]');
    await at(t.page, "map");
    await t.page.click("#chap");
    await t.page.keyboard.press("Escape");
    assert.ok(await t.page.locator("#menu").isHidden());
    await t.ctx.close();
  });

  for (const vp of [{ width: 360, height: 640 }, { width: 360, height: 740 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 1280, height: 720 }, { width: 1366, height: 768 }]) {
    await check("at the gate, the box to tick and Next are in view without scrolling at " + vp.width + "x" + vp.height, async () => {
      const mobile = vp.width < 700;
      const t = await open(browser, { viewport: vp, mobile });
      await t.page.click("#start");
      await at(t.page, "consent");
      const r = await t.page.evaluate(() => {
        const a = document.querySelector('[data-step="consent"] .agree').getBoundingClientRect();
        const n = document.getElementById("next").getBoundingClientRect();
        const p = document.querySelector('[data-step="consent"]');
        return { agreeTop: a.top, agreeBottom: a.bottom, nextTop: n.top, nextBottom: n.bottom, h: innerHeight, scrolled: p.scrollTop };
      });
      const limit = mobile ? Math.min(r.nextTop - 4, r.h - 84) : r.h;
      assert.ok(r.agreeTop >= 0 && r.agreeBottom <= limit, "the box to tick is hidden: " + JSON.stringify(r));
      assert.ok(r.nextBottom <= r.h, "Next is off screen: " + JSON.stringify(r));
      assert.strictEqual(r.scrolled, 0);
      await t.ctx.close();
    });
  }

  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 664 }, { width: 412, height: 720 }, { width: 1366, height: 768 }]) {
    await check("from home to the pass, every answer is in view without scrolling at " + vp.width + "x" + vp.height, async () => {
      const mobile = vp.width < 700;
      const t = await open(browser, { viewport: vp, mobile, reduced: true });
      await t.page.click("#start");
      await at(t.page, "consent");
      await t.page.click(inStep("consent", ".agree"));
      await at(t.page, "home");
      for (const id of ["home", "year", "faculty", "org", "scholarship", "firstGen"]) {
        await t.page.evaluate(x => window.__survey.go(x), id);
        await at(t.page, id);
        const hidden = await t.page.evaluate(({ id, mobile }) => {
          const p = document.querySelector('[data-step="' + id + '"]'), pr = p.getBoundingClientRect();
          const n = document.getElementById("next").getBoundingClientRect();
          const bottom = mobile ? Math.min(innerHeight - 84, n.top) : Math.min(pr.bottom, innerHeight);
          return Array.from(p.querySelectorAll("[data-v]")).filter(e => { const b = e.getBoundingClientRect(); return b.bottom > bottom + 1 || b.top < pr.top - 1; }).map(e => e.dataset.v);
        }, { id, mobile });
        assert.deepStrictEqual(hidden, [], id + ": answers below the fold");
      }
      await t.ctx.close();
    });
  }

  await check("the guard keeps the gate shut until the box is ticked, and nothing about age is asked", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    assert.strictEqual(await t.page.locator("#gate-say span").textContent(), "Are you a student?");
    assert.strictEqual(await t.page.locator(".scene.gate-open").count(), 0, "the gate starts closed");
    await t.page.click("#next", { force: true });
    assert.strictEqual(await current(t.page), "consent", "Next does not pass the gate before the box is ticked");
    await t.page.click(inStep("consent", ".agree"));
    assert.strictEqual(await t.page.locator("#gate-say span").textContent(), "Come in!");
    assert.strictEqual(await t.page.locator(".scene.gate-open").count(), 1, "the gate opens");
    await at(t.page, "home");
    const a = await t.page.evaluate(() => window.__survey.answers);
    assert.strictEqual(a.consent, true);
    assert.strictEqual(a.age18, true);
    assert.ok(a.startedAt);
    await t.ctx.close();
  });

  await check("only the eyes follow the pointer", async () => {
    const t = await open(browser, {});
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.mouse.move(5, 5);
    await t.page.mouse.move(1300, 700, { steps: 8 });
    await t.page.waitForTimeout(700);
    const moved = await t.page.evaluate(() => {
      const out = { pupils: 0, others: [] };
      document.querySelectorAll('[data-box="gate"] svg *').forEach(el => {
        const tr = getComputedStyle(el).transform;
        if (!tr || tr === "none" || el.closest(".arm, .say, .wave, .bubble")) return;
        if (el.classList.contains("pupil")) out.pupils++; else out.others.push(el.tagName + "." + el.getAttribute("class"));
      });
      return out;
    });
    assert.ok(moved.pupils >= 2, "the guard's eyes follow the pointer");
    assert.deepStrictEqual(moved.others, [], "nothing else in the scene moves with the pointer");
    await t.ctx.close();
  });

  await check("the walk works with reduced motion", async () => {
    const t = await open(browser, { reduced: true, mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    await t.page.click(btn("home", "An on-campus dorm"));
    await at(t.page, "year");
    await t.page.evaluate(() => window.__survey.go("firstGen"));
    await at(t.page, "firstGen");
    await next(t.page);
    await at(t.page, "sources");
    assert.deepStrictEqual(t.errors, []);
    await t.ctx.close();
  });

  await check("the receiver refuses records without consent, age, or the current version", async () => {
    const ok = { consent: true, age18: true, variant: "scenes", version: "scenes-v2" };
    assert.strictEqual(receiver.refusal_(ok), "");
    assert.ok(receiver.refusal_(Object.assign({}, ok, { consent: false })));
    assert.ok(receiver.refusal_(Object.assign({}, ok, { age18: false })));
    assert.ok(receiver.refusal_(Object.assign({}, ok, { version: "scenes-v1" })));
    assert.strictEqual(receiver.cell_("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  });

  await browser.close();
  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
