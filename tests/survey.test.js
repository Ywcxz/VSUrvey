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
const PROD = "https://project-campus-vsurvey.vercel.app/";
const OLD_PROD = "https://istorya-sa-vsu.vercel.app/";
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
    if (u.startsWith(PROD) || u.startsWith(OLD_PROD) || u.startsWith(PREVIEW)) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: o.closed ? HTML : HTML_OPEN });
    if (u.startsWith("https://script.google.com/")) { posts.push(req.postData()); return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); }
    return route.abort();
  });
  await page.goto((o.host || PROD) + (o.query || ""));
  return { ctx, page, posts, errors };
}

const current = page => page.evaluate(() => window.__survey.current());
/* On phones Send sits in the bottom bar; on computers it is the button in the panel. */
async function sendIt(page) {
  if (await page.locator("#send").isVisible()) return page.click("#send");
  assert.strictEqual(await page.locator("#next-lbl").textContent(), "Send", "the bottom bar offers Send on a phone");
  return page.click("#next");
}
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
  i: ["Several times", "Moderate"], j: ["Never"], k: ["Once or twice", "Minor"], l: ["Never"], m: ["Often", "Serious"],
  p: ["Several times", "Serious"]
};

async function scene(page, k, shot) {
  const id = "m-" + k, plan = PLAN[k];
  await at(page, id, shot);
  await page.click(inStep(id, '[data-key="often:' + k + '"] [data-v="' + plan[0] + '"]'));
  if (plan[1]) await page.click(inStep(id, '[data-key="matters:' + k + '"] [data-v="' + plan[1] + '"]'));
}

async function walkAll(page, shot) {
  await at(page, "intro", shot);
  await page.click("#start");
  await at(page, "consent", shot);
  await page.click(inStep("consent", ".agree"));
  await at(page, "home", shot);
  assert.strictEqual(await page.locator(inStep("home", ".kicker")).textContent(), "Mornings, 1 of 2");
  await page.click(btn("home", "A relative's or friend's house"));
  await at(page, "transport", shot);
  await page.click(btn("transport", "Habal-habal or tricycle"));
  await at(page, "year", shot);
  await page.click(btn("year", "2nd"));
  await at(page, "faculty", shot);
  await page.click(btn("faculty", "Faculty of Engineering"));
  await at(page, "org", shot);
  await page.click(btn("org", "A member, but not active"));
  await at(page, "scholarship", shot);
  await page.click(btn("scholarship", "No"));
  await at(page, "transferee", shot);
  assert.strictEqual(await page.locator(inStep("transferee", ".kicker")).textContent(), "Your form, 5 of 6");
  await page.click(btn("transferee", "Yes"));
  await at(page, "firstGen", shot);
  await page.click(btn("firstGen", "Yes"));
  if (SHOTS && shot) { await page.waitForTimeout(1700); await page.screenshot({ path: path.join(SHOTS, shot + "-firstGen-printed.png") }); }
  await at(page, "networks", shot);
  await page.click(btn("networks", "Smart"));
  await page.click(btn("networks", "DITO"));
  await next(page);
  await at(page, "load", shot);
  await page.click(btn("load", "Data for certain apps only"));
  await page.click(btn("load", "Calls and texts"));
  await next(page);
  await at(page, "loadApps", shot);
  await page.click(btn("loadApps", "Facebook and Messenger"));
  await page.click(btn("loadApps", "TikTok"));
  await page.click(btn("loadApps", "School apps, like Google Workspace, Zoom, or Canva"));
  await next(page);
  await at(page, "dataSpend", shot);
  await page.click(btn("dataSpend", "₱50 to ₱99"));
  await at(page, "dataSchool", shot);
  await page.click(btn("dataSchool", "About half"));
  await at(page, "signal", shot);
  assert.strictEqual(await page.locator(inStep("signal", ".kicker")).textContent(), "Getting online, 6 of 9");
  await page.click(btn("signal", "On campus only"));
  await at(page, "onlineCampus", shot);
  await page.click(btn("onlineCampus", "Mobile data"));
  await page.click(btn("onlineCampus", "Campus Wi-Fi"));
  await next(page);
  await at(page, "onlineHome", shot);
  await page.click(btn("onlineHome", "Piso Wi-Fi"));
  await page.click(btn("onlineHome", "Pocket Wi-Fi"));
  await next(page);
  await at(page, "wifiSpend", shot);
  await page.click(btn("wifiSpend", "Under ₱50"));
  // Hearing from VSU
  await at(page, "firstSuspensions", shot);
  assert.strictEqual(await page.locator(inStep("firstSuspensions", ".vig")).count(), 8, "every channel is offered");
  assert.strictEqual(await page.locator(inStep("firstSuspensions", ".none-row .chip")).count(), 1, "suspensions offer only Too late");
  assert.strictEqual(await page.locator(inStep("firstSuspensions", ".kicker")).textContent(), "Hearing from VSU, 1 of 10");
  await page.click(btn("firstSuspensions", "Group chats: class, org, dorm"));
  await at(page, "firstDocuments", shot);
  await page.click(btn("firstDocuments", "Official VSU pages or website"));
  await at(page, "firstEvents", shot);
  assert.strictEqual(await page.locator(inStep("firstEvents", ".none-row .chip")).count(), 2, "events also offer Doesn't apply");
  await page.click(btn("firstEvents", "Unofficial groups, like freedom walls"));
  await at(page, "firstScholarships", shot);
  await page.click(btn("firstScholarships", "Too late, or never"));
  await at(page, "firstAnnouncements", shot);
  await page.click(btn("firstAnnouncements", "Student council or org pages"));
  for (const k of ["d", "o", "f", "g", "k"]) await scene(page, k, shot);
  assert.strictEqual(await page.locator(inStep("m-k", ".kicker")).textContent(), "Hearing from VSU, 10 of 10");
  // Reaching VSU
  await at(page, "scenario", shot);
  assert.strictEqual(await page.locator(inStep("scenario", ".kicker")).textContent(), "Reaching VSU, 1 of 8");
  await page.click(btn("scenario", "Asked in a student Facebook group"));
  for (const k of ["a", "e"]) await scene(page, k, shot);
  await at(page, "reachHow", shot);
  await page.click(btn("reachHow", "Messenger or another chat app"));
  await at(page, "reachGot", shot);
  assert.strictEqual(await page.locator(inStep("reachGot", ".kicker")).textContent(), "Reaching VSU, 5 of 8", "every screen is counted");
  await page.click(btn("reachGot", "Yes, but it took days"));
  await scene(page, "c", shot);
  await at(page, "concern", shot);
  await page.click(btn("concern", "Went to the student council or an org"));
  await page.click(btn("concern", "Used a suggestion box or feedback form"));
  await next(page);
  await scene(page, "p", shot);
  // Students and alumni
  await at(page, "askFirst", shot);
  await page.click(btn("askFirst", "A group chat"));
  for (const k of ["b", "n"]) await scene(page, k, shot);
  await at(page, "trust", shot);
  await page.click(btn("trust", "4"));
  await at(page, "postedAnonymously", shot);
  await page.click(btn("postedAnonymously", "Yes"));
  for (const k of ["h", "l"]) await scene(page, k, shot);
  // Campus life
  for (const k of ["i", "j", "m"]) await scene(page, k, shot);
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
  await at(page, "worksWell", shot);
  await page.click(btn("worksWell", "Everyone is already there"));
  await page.click(btn("worksWell", "Works with my load promo"));
  await next(page);
  await at(page, "wouldUse", shot);
  await page.click(btn("wouldUse", "Notices and deadlines in one place"));
  await page.click(btn("wouldUse", "Questions about my subjects"));
  await next(page);
  await at(page, "postPreference", shot);
  await page.click(btn("postPreference", "Under a made-up name other members can't link to me"));
  await at(page, "wantBack", shot);
  await page.click(btn("wantBack", "A fix, or a reason it can't be fixed"));
  await at(page, "keepAway", shot);
  await page.click(btn("keepAway", "Uses too much mobile data"));
  await next(page);
  await at(page, "send", shot);
  await page.fill("#comment", "Will the results be shared with students?");
  await sendIt(page);
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
      assert.strictEqual(r.version, "scenes-v3");
      assert.strictEqual(r.survey, "student-life-2026");
      assert.strictEqual(rowOf(r).survey, "student-life-2026");
      const how = await t.page.evaluate(() => document.querySelector(".how span").textContent);
      assert.ok(how.indexOf(mobile ? "Tap an answer" : "Click an answer") === 0, "the intro says " + (mobile ? "Tap" : "Click") + " on a " + label + ": " + how);
      assert.strictEqual(r.consent, true);
      assert.strictEqual(r.age18, true);
      assert.strictEqual(r.test, false);
      assert.ok(r.startedAt && r.sentAt && r.startedAt <= r.sentAt, "startedAt and sentAt");
      for (const k of ["birthYear", "birthMonth", "decade", "month", "year_of_birth"]) assert.ok(!(k in r), "the record must not carry " + k);
      assert.ok(!/\b(19|20)\d\d-\d\d-\d\d\b/.test(JSON.stringify(Object.assign({}, r, { startedAt: "", sentAt: "" }))), "no dates beyond the timestamps");
      assert.strictEqual(r.residence, "A relative's or friend's house");
      assert.strictEqual(r.transport, "Habal-habal or tricycle");
      assert.strictEqual(r.org, "A member, but not active");
      assert.strictEqual(r.transferee, "Yes");
      assert.strictEqual(r.wifiSpend, "Under ₱50");
      assert.strictEqual(r.faculty, "Faculty of Engineering");
      assert.strictEqual(r.firstGen, "Yes");
      assert.strictEqual(r.firstSuspensions, "Group chats: class, org, dorm");
      assert.strictEqual(r.firstDocuments, "Official VSU pages or website");
      assert.strictEqual(r.firstAnnouncements, "Student council or org pages");
      assert.strictEqual(r.firstEvents, "Unofficial groups, like freedom walls");
      assert.strictEqual(r.firstScholarships, "Too late, or never");
      for (const k of ["mainSource", "sources", "sourcesOther"]) assert.ok(!(k in r), "the record no longer carries " + k + " (D-119)");
      assert.strictEqual(r.reachHow, "Messenger or another chat app");
      assert.strictEqual(r.reachGot, "Yes, but it took days");
      assert.deepStrictEqual(r.concern, ["Went to the student council or an org", "Used a suggestion box or feedback form"]);
      assert.strictEqual(r.askFirst, "A group chat");
      assert.deepStrictEqual(r.worksWell, ["Everyone is already there", "Works with my load promo"]);
      assert.strictEqual(rowOf(r).firstScholarships, "Too late, or never");
      assert.strictEqual(r.dataSpend, "₱50 to ₱99");
      assert.strictEqual(r.dataSchool, "About half");
      assert.deepStrictEqual(r.networks, ["Smart", "DITO"]);
      assert.deepStrictEqual(r.load, ["Data for certain apps only", "Calls and texts"]);
      assert.deepStrictEqual(r.loadApps, ["Facebook and Messenger", "TikTok", "School apps, like Google Workspace, Zoom, or Canva"]);
      assert.strictEqual(r.signal, "On campus only");
      assert.deepStrictEqual(r.onlineCampus, ["Mobile data", "Campus Wi-Fi"]);
      assert.deepStrictEqual(r.onlineHome, ["Piso Wi-Fi", "Pocket Wi-Fi"]);
      assert.ok(!("online" in r), "the old online field is gone");
      assert.strictEqual(r.wantBack, "A fix, or a reason it can't be fixed");
      assert.strictEqual(Object.keys(r.board).length, 16);
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
      assert.strictEqual(row.reachGot, "Yes, but it took days");
      assert.strictEqual(row["concern: Used a suggestion box or feedback form"], true);
      assert.strictEqual(row["concern: unlisted"], "");
      assert.strictEqual(row.askFirst, "A group chat");
      assert.strictEqual(row["worksWell: Works with my load promo"], true);
      assert.strictEqual(row["worksWell: unlisted"], "");
      assert.strictEqual(row["wouldUse: Questions about my subjects"], true);
      assert.strictEqual(row["wouldUse: unlisted"], "");
      assert.strictEqual(row["away: unlisted"], "");
      assert.strictEqual(row["n often"], "Once or twice");
      assert.strictEqual(row["o matters"], "Serious");
      assert.strictEqual(row["p often"], "Several times");
      assert.strictEqual(row["network: DITO"], true);
      assert.strictEqual(row["network: unlisted"], "");
      assert.strictEqual(row["load: Calls and texts"], true);
      assert.strictEqual(row["loadApps: TikTok"], true);
      assert.strictEqual(row.signal, "On campus only");
      assert.strictEqual(row.transport, "Habal-habal or tricycle");
      assert.strictEqual(row.transferee, "Yes");
      assert.strictEqual(row.wifiSpend, "Under ₱50");
      assert.strictEqual(row.firstAnnouncements, "Student council or org pages");
      assert.strictEqual(row["loadApps: School apps, like Google Workspace, Zoom, or Canva"], true);
      assert.strictEqual(row["onCampus: Campus Wi-Fi"], true);
      assert.strictEqual(row["whereStaying: Pocket Wi-Fi"], true);
      assert.strictEqual(row["whereStaying: unlisted"], "");
      assert.strictEqual(row.wantBack, "A fix, or a reason it can't be fixed");
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
      return { networks: get("networks", "networks"), oc: get("onlineCampus", "onlineCampus"), oh: get("onlineHome", "onlineHome"), load: get("load", "load"), apps: get("loadApps", "loadApps"), concern: get("concern", "concern"), works: get("worksWell", "worksWell"), pull: get("wouldUse", "wouldUse"), away: get("keepAway", "keepAway"), moments: window.__survey.steps().filter(id => id.indexOf("m-") === 0).map(id => id.slice(2)) };
    });
    assert.deepStrictEqual(vals.concern.slice().sort(), receiver.CONCERN.slice().sort());
    assert.deepStrictEqual(vals.works.slice().sort(), receiver.WORKS.slice().sort());
    assert.deepStrictEqual(vals.networks.slice().sort(), receiver.NETWORKS.slice().sort());
    assert.deepStrictEqual(vals.oc.slice().sort(), receiver.ONLINE_CAMPUS.slice().sort());
    assert.deepStrictEqual(vals.oh.slice().sort(), receiver.ONLINE_HOME.slice().sort());
    assert.deepStrictEqual(vals.load.slice().sort(), receiver.LOAD.slice().sort());
    assert.deepStrictEqual(vals.apps.slice().sort(), receiver.LOAD_APPS.slice().sort());
    assert.deepStrictEqual(vals.pull.slice().sort(), receiver.WOULD_USE.slice().sort());
    assert.deepStrictEqual(vals.away.slice().sort(), receiver.AWAY.slice().sort());
    assert.deepStrictEqual(vals.moments.slice().sort(), receiver.MOMENTS.slice().sort());
    await t.ctx.close();
  });

  await check("no SIM skips the questions about load and spending, and clears them", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    await t.page.evaluate(() => window.__survey.go("networks"));
    await at(t.page, "networks");
    await t.page.click(btn("networks", "Globe"));
    await t.page.click(btn("networks", "No SIM or mobile data"));
    const a = await t.page.evaluate(() => window.__survey.answers.networks);
    assert.deepStrictEqual(a, ["No SIM or mobile data"], "No SIM clears the networks picked before it");
    await next(t.page);
    await at(t.page, "onlineCampus");
    await t.page.click(btn("onlineCampus", "Campus Wi-Fi"));
    await next(t.page);
    await at(t.page, "onlineHome");
    const steps = await t.page.evaluate(() => window.__survey.steps());
    for (const id of ["load", "loadApps", "dataSpend", "dataSchool", "signal"]) assert.ok(steps.indexOf(id) < 0, id + " is skipped");
    await t.ctx.close();
  });

  await check("networks take at most two picks, and no load skips what load costs and covers", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    const ans = () => t.page.evaluate(() => window.__survey.answers);
    const steps = () => t.page.evaluate(() => window.__survey.steps());
    await t.page.evaluate(() => window.__survey.go("networks"));
    await at(t.page, "networks");
    assert.strictEqual(await t.page.locator(inStep("networks", '[data-v="Another network"]')).count(), 0, "Another network is gone");
    for (const n of ["Smart", "TNT", "Globe", "TM", "GOMO", "DITO"]) assert.strictEqual(await t.page.locator(btn("networks", n)).count(), 1, n + " has its own button");
    await t.page.click(btn("networks", "Smart"));
    await t.page.click(btn("networks", "DITO"));
    await t.page.click(btn("networks", "Globe"));
    assert.deepStrictEqual((await ans()).networks, ["Smart", "DITO"], "a third network is refused");
    await next(t.page);
    await at(t.page, "load");
    await t.page.click(btn("load", "Data for any site or app"));
    await next(t.page);
    await at(t.page, "dataSpend");
    await t.page.click(btn("dataSpend", "Under ₱50"));
    await at(t.page, "dataSchool");
    await t.page.click(btn("dataSchool", "Almost all"));
    await at(t.page, "signal");
    await t.page.click(btn("signal", "Where I stay only"));
    await t.page.evaluate(() => window.__survey.go("load"));
    await at(t.page, "load");
    await t.page.click(btn("load", "I don't buy load"));
    let a = await ans();
    assert.deepStrictEqual([a.dataSpend, a.dataSchool, a.signal], [null, null, null], "no load clears spending, schoolwork, and signal");
    let L = await steps();
    for (const id of ["loadApps", "dataSpend", "dataSchool", "signal"]) assert.ok(!L.includes(id), id + " is skipped with no load");
    await next(t.page);
    await at(t.page, "onlineCampus");
    await t.page.evaluate(() => window.__survey.go("load"));
    await at(t.page, "load");
    await t.page.click(btn("load", "Calls and texts"));
    L = await steps();
    assert.ok(L.includes("dataSpend"), "calls and texts still cost load");
    for (const id of ["dataSchool", "signal"]) assert.ok(!L.includes(id), id + " is skipped with calls and texts only");
    await t.page.click(btn("load", "A postpaid plan"));
    L = await steps();
    for (const id of ["dataSpend", "dataSchool", "signal"]) assert.ok(L.includes(id), id + " is asked of a postpaid plan");
    await t.page.evaluate(() => window.__survey.go("onlineHome"));
    await at(t.page, "onlineHome");
    await t.page.click(btn("onlineHome", "Mobile data"));
    await t.page.click(btn("onlineHome", "I usually can't"));
    assert.deepStrictEqual((await ans()).onlineHome, ["I usually can't"], "I usually can't stands alone");
    assert.deepStrictEqual(t.errors, []);
    await t.ctx.close();
  });

  await check("skipping every question still sends a valid record", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    const FORM = ["year", "faculty", "org", "scholarship", "transferee", "firstGen"];
    for (let i = 0; i < 90 && (await current(t.page)) !== "send"; i++) {
      const before = await current(t.page);
      if (FORM.includes(before)) {
        assert.ok(await t.page.locator("#next.locked").count() === 1, "a form question can't be skipped (" + before + ")");
        await t.page.click(btn(before, "Prefer not to say"));
      } else {
        assert.strictEqual(await t.page.locator("#next-lbl").textContent(), "Skip", "the button says Skip on an unanswered step (" + before + ")");
        await next(t.page);
      }
      await t.page.waitForFunction(x => window.__survey.current() !== x, before, { timeout: 5000 });
    }
    await at(t.page, "send");
    assert.ok((await t.page.locator("#skipped").textContent()).indexOf("You skipped") === 0);
    await sendIt(t.page);
    await at(t.page, "final");
    const r = JSON.parse(t.posts[0]);
    assert.strictEqual(r.residence, null);
    assert.deepStrictEqual(r.board, {});
    assert.deepStrictEqual(r.pins, []);
    for (const k of ["transport", "firstSuspensions", "firstDocuments", "firstEvents", "firstScholarships", "firstAnnouncements", "reachHow", "reachGot", "askFirst", "wifiSpend"]) assert.strictEqual(r[k], null, k);
    for (const k of ["year", "faculty", "org", "scholarship", "transferee", "firstGen"]) assert.strictEqual(r[k], "Prefer not to say", k + " was declined, not skipped");
    assert.deepStrictEqual(r.concern, []);
    assert.deepStrictEqual(r.worksWell, []);
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

  await check("the old address still counts as live during the switch", async () => {
    const t = await open(browser, { host: OLD_PROD });
    assert.strictEqual(await t.page.evaluate(() => window.__survey.live), true);
    await t.ctx.close();
  });

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
    await sendIt(t.page);
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
    await sendIt(t.page);
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
    await sendIt(t.page);
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
    await at(t.page, "transport");
    await t.page.keyboard.press("ArrowLeft");
    await at(t.page, "home");
    await t.page.click("#chap");
    await t.page.click('#menu [data-jump="map"]');
    await at(t.page, "year");
    assert.ok(true, "the menu stops at the first form question still to answer");
    await t.page.evaluate(() => { const a = window.__survey.answers; for (const k of ["year", "faculty", "org", "scholarship", "transferee", "firstGen"]) a[k] = "Prefer not to say"; });
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
      for (const id of ["home", "transport", "year", "faculty", "org", "scholarship", "transferee", "firstGen"]) {
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

  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 664 }, { width: 412, height: 720 }, { width: 390, height: 844 }, { width: 1366, height: 768 }]) {
    await check("from the news to Send, every answer is in view without scrolling at " + vp.width + "x" + vp.height, async () => {
      const mobile = vp.width < 700;
      const t = await open(browser, { viewport: vp, mobile, reduced: true });
      await t.page.click("#start");
      await at(t.page, "consent");
      await t.page.click(inStep("consent", ".agree"));
      await at(t.page, "home");
      const fold = ({ id, mobile }) => {
        const p = document.querySelector('[data-step="' + id + '"]'), pr = p.getBoundingClientRect();
        const n = document.getElementById("next"), nr = n.getBoundingClientRect();
        const bottom = mobile ? Math.min(innerHeight - 84, n.hidden ? innerHeight : nr.top) : Math.min(pr.bottom, innerHeight);
        return Array.from(p.querySelectorAll("[data-v], textarea, #send")).filter(e => e.offsetParent !== null && true).filter(e => { const b = e.getBoundingClientRect(); return b.bottom > bottom + 1 || b.top < pr.top - 1; }).map(e => e.dataset.v || e.id);
      };
      // Nine scenes happened, so the coins step shows nine jars.
      const scenes = (await t.page.evaluate(() => window.__survey.steps())).filter(x => x.startsWith("m-"));
      await t.page.evaluate(() => { const a = window.__survey.answers; a.load = ["Data for certain apps only"]; });
      const ids = (await t.page.evaluate(() => window.__survey.steps())).filter(x => ["networks", "load", "loadApps", "dataSpend", "dataSchool", "signal", "onlineCampus", "onlineHome", "wifiSpend", "firstSuspensions", "firstDocuments", "firstEvents", "firstScholarships", "firstAnnouncements", "scenario", "reachHow", "reachGot", "concern", "askFirst", "map", "coins", "story", "trust", "postedAnonymously", "worksWell", "wouldUse", "postPreference", "wantBack", "keepAway", "send"].indexOf(x) >= 0 || x.startsWith("m-"));
      for (const id of ids) {
        await t.page.evaluate(x => window.__survey.go(x), id);
        await at(t.page, id);
        if (id.startsWith("m-")) {
          // "Once or twice" for the first nine scenes, "It never happened" after; the follow-up must fit too.
          await t.page.click(inStep(id, '[data-key^="often"] .chip:nth-child(' + (scenes.indexOf(id) < 9 ? 2 : 1) + ")"));
          await t.page.evaluate(x => window.__survey.go(x), id);
        }
        if (id === "map") await t.page.click(inStep("map", ".pinpick .chip"));
        assert.deepStrictEqual(await t.page.evaluate(fold, { id, mobile }), [], id + ": answers below the fold");
      }
      if (mobile) assert.strictEqual(await t.page.locator("#next-lbl").textContent(), "Send", "Send is in the bottom bar");
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
    await at(t.page, "transport");
    await t.page.evaluate(() => window.__survey.go("firstGen"));
    await at(t.page, "firstGen");
    await t.page.click(btn("firstGen", "Prefer not to say"));
    await at(t.page, "networks");
    assert.deepStrictEqual(t.errors, []);
    await t.ctx.close();
  });

  await check("the four communication parts are in the menu, and the follow-ups behave", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    const steps = () => t.page.evaluate(() => window.__survey.steps());
    const ans = () => t.page.evaluate(() => window.__survey.answers);
    await t.page.click("#chap");
    const parts = await t.page.locator(".menu-list span").allTextContents();
    for (const p of ["Mornings", "Your form", "Getting online", "Hearing from VSU", "Reaching VSU", "Students and alumni", "Campus life"]) assert.ok(parts.includes(p), p + " is a part");
    for (const p of ["Home", "Mobile data", "News", "Errand", "Scenes", "Trust"]) assert.ok(!parts.includes(p), p + " is no longer a part");
    await t.page.keyboard.press("Escape");
    assert.ok((await steps()).includes("reachGot"), "Did you get what you needed? counts as coming until ruled out");
    await t.page.evaluate(() => window.__survey.go("reachHow"));
    await at(t.page, "reachHow");
    await t.page.click(btn("reachHow", "Email"));
    await at(t.page, "reachGot");
    await t.page.click(btn("reachGot", "Only partly"));
    await t.page.evaluate(() => window.__survey.go("reachHow"));
    await at(t.page, "reachHow");
    await t.page.click(btn("reachHow", "It hasn't happened"));
    assert.strictEqual((await ans()).reachGot, null, "It hasn't happened clears the follow-up");
    assert.ok(!(await steps()).includes("reachGot"), "and skips it");
    await t.page.evaluate(() => window.__survey.go("concern"));
    await at(t.page, "concern");
    await t.page.click(btn("concern", "Told the office directly"));
    await t.page.click(btn("concern", "It hasn't happened"));
    assert.deepStrictEqual((await ans()).concern, ["It hasn't happened"], "It hasn't happened stands alone");
    await t.page.click(btn("concern", "Kept it to myself"));
    assert.deepStrictEqual((await ans()).concern, ["Kept it to myself"], "Kept it to myself stands alone too");
    await t.page.click(btn("concern", "Posted about it online"));
    assert.deepStrictEqual((await ans()).concern, ["Posted about it online"], "and gives way to anything done");
    await t.page.evaluate(() => window.__survey.go("worksWell"));
    await at(t.page, "worksWell");
    await t.page.click(btn("worksWell", "Nothing much"));
    await t.page.click(btn("worksWell", "News spreads fast"));
    assert.deepStrictEqual((await ans()).worksWell, ["News spreads fast"], "Nothing much gives way to a pick");
    const order = (await steps()).filter(x => x.startsWith("m-")).map(x => x.slice(2)).join("");
    assert.strictEqual(order, "dofgkaecpbnhlijm", "scenes follow the parts");
    assert.deepStrictEqual(t.errors, []);
    await t.ctx.close();
  });

  await check("the desk types each answer onto the form on its monitor, and hands the form over", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    await t.page.evaluate(() => window.__survey.go("year"));
    await at(t.page, "year");
    const bar = i => t.page.evaluate(n => document.querySelector('[data-box="pass"] [data-bar="' + n + '"]').getAttribute("class"), i);
    assert.ok(!/\bon\b/.test(await bar(0)), "the monitor starts empty");
    await t.page.click(btn("year", "3rd"));
    assert.ok(await t.page.locator('[data-box="pass"] .scene.typing').count() === 1, "an answer is typed in");
    assert.ok(/\bon\b/.test(await bar(0)), "and its line fills");
    await at(t.page, "faculty");
    assert.ok(await t.page.locator("#next.locked").count() === 1, "a form question can't be skipped");
    await t.page.click(btn("faculty", "Prefer not to say"));
    assert.ok(/\bon\b/.test(await bar(1)), "Prefer not to say is typed in too");
    await at(t.page, "org");
    await t.page.evaluate(() => window.__survey.go("firstGen"));
    await at(t.page, "firstGen");
    await t.page.click(btn("firstGen", "No"));
    await t.page.waitForFunction(() => document.getElementById("passwrap").classList.contains("handing"), null, { timeout: 2500 });
    assert.strictEqual(await current(t.page), "firstGen", "the walk waits while the pass is handed over");
    await at(t.page, "networks");
    assert.ok(await t.page.evaluate(() => document.getElementById("passwrap").classList.contains("gone")), "the pass has left the desk");
    assert.deepStrictEqual(t.errors, []);
    await t.ctx.close();
  });

  await check("the receiver refuses records without consent, age, or the current version", async () => {
    const ok = { consent: true, age18: true, variant: "scenes", version: "scenes-v3" };
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
