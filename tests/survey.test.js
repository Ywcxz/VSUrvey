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
  if (process.env.ONLY && name.indexOf(process.env.ONLY) < 0) return;
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String((e && e.stack) || e).split("\n").slice(0, 12).join("\n     ")); }
}

/* On phones the drawing stays in view, and answers that don't fit scroll below it (D-125): the stage keeps at least 12% of the
   screen where the part has one, and scrolling to the end brings the last answer above the bottom bar. Returns what fails. */
const PHONE_FIT = `window.phoneFit = function (p, bottom) {
  var box = p.closest(".box"), st = box.querySelector(".stage"), bad = [], has = st && !box.classList.contains("nostage");
  if (has && getComputedStyle(st).display === "none") bad.push("drawing hidden");
  else if (has && st.offsetHeight < innerHeight * 0.12) bad.push("drawing " + st.offsetHeight + "px");
  p.scrollTop = p.scrollHeight;
  var els = Array.from(p.querySelectorAll("[data-v], textarea, #send")).filter(function (e) { return e.offsetParent !== null; });
  var last = els.reduce(function (m, e) { return Math.max(m, e.getBoundingClientRect().bottom); }, 0);
  if (last > bottom + 1) bad.push("last answer " + Math.round(last - bottom) + "px under the bar");
  p.scrollTop = 0;
  return bad;
};`;
async function open(browser, o = {}) {
  const mobile = !!o.mobile;
  const ctx = await browser.newContext({ viewport: o.viewport || (mobile ? PHONE : DESKTOP), hasTouch: mobile, isMobile: mobile, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  await page.addInitScript(PHONE_FIT);
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
  o: ["Several times", "Serious"], e: ["Often", "Moderate"], f: ["Never"], g: ["Once or twice", "Not a problem"],
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
  assert.strictEqual(await page.locator(inStep("home", ".kicker")).textContent(), "Where you wake up", "each question has a label, not a number");
  await page.click(btn("home", "A relative's or friend's house"));
  await at(page, "transport", shot);
  await page.click(btn("transport", "Habal-habal or tricycle"));
  await at(page, "year", shot);
  await page.click(btn("year", "2nd"));
  await at(page, "faculty", shot);
  await page.click(btn("faculty", "Faculty of Engineering"));
  await at(page, "org", shot);
  await page.click(btn("org", "A member, but I rarely take part"));
  await at(page, "scholarship", shot);
  await page.click(btn("scholarship", "No"));
  await at(page, "transferee", shot);
  assert.strictEqual(await page.locator(inStep("transferee", ".kicker")).textContent(), "Before VSU");
  assert.strictEqual(await page.locator('#passcard [data-f="transferee"]').count(), 0, "the printed form has no Other school line");
  await page.click(btn("transferee", "Yes"));
  await at(page, "firstGen", shot);
  await page.click(btn("firstGen", "Yes"));
  if (SHOTS && shot) { await page.waitForTimeout(1700); await page.screenshot({ path: path.join(SHOTS, shot + "-firstGen-printed.png") }); }
  await at(page, "networks", shot);
  assert.strictEqual(await page.locator(btn("networks", "I don't use a SIM")).count(), 0, "no SIM means skipping the question");
  await page.click(btn("networks", "Smart"));
  await page.click(btn("networks", "DITO"));
  await next(page);
  await at(page, "twoSims", shot);
  await page.click(btn("twoSims", "To switch when one has weak signal"));
  await page.click(btn("twoSims", "I pick each network's promo by need, like exam week"));
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
  await at(page, "validity", shot);
  assert.strictEqual(await page.locator(btn("validity", "Regular load, no promo")).count(), 0, "no promo means skipping the question");
  await page.click(btn("validity", "7 days"));
  await at(page, "untilExpiry", shot);
  assert.strictEqual(await page.locator(inStep("untilExpiry", ".kicker")).textContent(), "Follow-upData allocation");
  await page.click(btn("untilExpiry", "No, it runs out early"));
  await at(page, "reload", shot);
  assert.strictEqual(await page.locator(inStep("reload", ".kicker")).textContent(), "Follow-upAnother promo");
  assert.strictEqual(await page.locator(inStep("reload", ".because")).textContent(), "Because you picked \u201CNo, it runs out early\u201D.");
  await page.click(btn("reload", "Yes, right away"));
  await at(page, "reloadWhy", shot);
  await page.click(btn("reloadWhy", "I still had app data, but needed other sites"));
  await next(page);
  await at(page, "dataSpend", shot);
  await page.click(btn("dataSpend", "₱99 or ₱100"));
  await at(page, "dataSchool", shot);
  await page.click(btn("dataSchool", "About half"));
  await at(page, "signal", shot);
  assert.strictEqual(await page.locator(inStep("signal", ".kicker")).textContent(), "Usable data");
  await page.click(btn("signal", "On campus only"));
  await at(page, "onlineCampus", shot);
  await page.click(btn("onlineCampus", "Mobile data"));
  await page.click(btn("onlineCampus", "Campus Wi-Fi"));
  await next(page);
  await at(page, "onlineHome", shot);
  assert.strictEqual(await page.locator(btn("onlineHome", "Pocket Wi-Fi")).count(), 0, "pocket Wi-Fi is mobile data");
  assert.strictEqual(await page.locator(btn("onlineHome", "Piso Wi-Fi")).count(), 0, "piso Wi-Fi counts as Wi-Fi");
  await page.click(btn("onlineHome", "Wi-Fi where I stay"));
  await next(page);
  await at(page, "wifiSpend", shot);
  await page.click(btn("wifiSpend", "₱200 to ₱499"));
  // Hearing from campus: up to three channels in order, in the owner's order for everyone
  await at(page, "firstClasses", shot);
  assert.strictEqual(await page.locator(inStep("firstClasses", ".kicker")).textContent(), "Class changes");
  const order = await page.locator(inStep("firstClasses", '[data-part="pick"] [data-v]')).evaluateAll(bs => bs.map(b => b.dataset.v));
  assert.deepStrictEqual(order, ["Official VSU pages or website", "Group chats: class, org, friends", "In person: class or friends", "Student council or org pages",
    "Unofficial groups, like freedom walls", "Email or text message", "Campus bulletin boards", "Somewhere else"], "the channels keep the owner's order");
  await page.click(btn("firstClasses", "Group chats: class, org, friends"));
  await page.click(btn("firstClasses", "In person: class or friends"));
  assert.strictEqual(await page.locator(btn("firstClasses", "In person: class or friends")).getAttribute("data-rank"), "2nd", "the second pick shows 2nd");
  await next(page);
  await at(page, "firstSuspensions", shot);
  assert.strictEqual(await page.locator(inStep("firstSuspensions", ".vig")).count(), 8, "every channel is offered");
  assert.strictEqual(await page.locator(inStep("firstSuspensions", ".none-row .chip")).count(), 2, "suspensions offer too late and never, apart");
  await page.click(btn("firstSuspensions", "Group chats: class, org, friends"));
  await page.click(btn("firstSuspensions", "Official VSU pages or website"));
  await next(page);
  await at(page, "firstDocuments", shot);
  await page.click(btn("firstDocuments", "Official VSU pages or website"));
  await next(page);
  await at(page, "firstEvents", shot);
  assert.strictEqual(await page.locator(inStep("firstEvents", ".none-row .chip")).count(), 3, "events also offer I don't look for these");
  assert.strictEqual(await page.locator(btn("firstEvents", "I don't look for these")).count(), 1);
  await page.click(btn("firstEvents", "Unofficial groups, like freedom walls"));
  await next(page);
  await at(page, "firstScholarships", shot);
  await page.click(btn("firstScholarships", "Usually too late"));
  await next(page);
  await at(page, "firstAnnouncements", shot);
  await page.click(btn("firstAnnouncements", "Student council or org pages"));
  await next(page);
  await at(page, "groupChats", shot);
  await page.click(btn("groupChats", "6 to 10"));
  await at(page, "officialHow", shot);
  await page.click(btn("officialHow", "Someone shares them with me"));
  await next(page);
  for (const k of ["d", "o"]) await scene(page, k, shot);
  await at(page, "checkPost", shot);
  await page.click(btn("checkPost", "Asked a friend or classmate"));
  await next(page);
  for (const k of ["f", "g", "k"]) await scene(page, k, shot);
  assert.strictEqual(await page.locator(inStep("m-k", ".kicker")).textContent(), "Work and OJT", "a scene's title is its label");
  // Reaching out
  await at(page, "scenario", shot);
  assert.strictEqual(await page.locator(inStep("scenario", ".kicker")).textContent(), "A new office");
  await page.click(btn("scenario", "Asked in a student Facebook group"));
  await at(page, "whichOffice", shot);
  await page.click(btn("whichOffice", "Registrar or records"));
  await at(page, "visitsTook", shot);
  await page.click(btn("visitsTook", "Two or three"));
  await at(page, "reachHow", shot);
  await page.click(btn("reachHow", "Messenger or another chat app"));
  await at(page, "reachGot", shot);
  assert.strictEqual(await page.locator(inStep("reachGot", ".kicker")).textContent(), "Follow-upDid it work");
  await page.click(btn("reachGot", "Yes, but it took days"));
  await at(page, "missClass", shot);
  await page.click(btn("missClass", "Yes, once"));
  await at(page, "concern", shot);
  const concernOrder = await page.locator(inStep("concern", "[data-v]")).evaluateAll(bs => bs.map(b => b.dataset.v));
  assert.strictEqual(concernOrder[0], "Kept it to myself", "Kept it to myself comes first");
  await page.click(btn("concern", "Went to the student council or an org"));
  await page.click(btn("concern", "Used a suggestion box or feedback form"));
  await next(page);
  await at(page, "concernHeard", shot);
  assert.strictEqual(await page.locator(inStep("concernHeard", ".because")).textContent(), "Because you picked \u201CWent to the student council or an org\u201D and \u201CUsed a suggestion box or feedback form\u201D.");
  await page.click(btn("concernHeard", "No, I never heard back"));
  for (const k of ["a", "c"]) await scene(page, k, shot);
  // Students and alumni
  await at(page, "askFirst", shot);
  await page.click(btn("askFirst", "A group chat"));
  await at(page, "fbPosting", shot);
  assert.strictEqual(await page.locator(inStep("fbPosting", ".kicker")).textContent(), "Posting in unofficial Facebook groups");
  await page.click(btn("fbPosting", "Yes, under a nickname"));
  await page.click(btn("fbPosting", "Yes, anonymously"));
  await next(page);
  for (const k of ["b", "n", "e", "l"]) await scene(page, k, shot);
  // Daily life: finding where you stay isn't asked of someone staying with a relative or friend
  await at(page, "lunch", shot);
  assert.ok(!(await page.evaluate(() => window.__survey.steps())).includes("whereFound"), "no finding where you stay at a relative's or friend's house");
  await page.click(btn("lunch", "Eateries near campus"));
  await at(page, "cantGoOut", shot);
  await page.click(btn("cantGoOut", "Ask a friend or classmate to buy it"));
  await next(page);
  await at(page, "buySell", shot);
  await page.click(btn("buySell", "Facebook groups or Marketplace"));
  await next(page);
  for (const k of ["i", "j", "m"]) await scene(page, k, shot);
  await at(page, "coins", shot);
  const jars = page.locator("#jars .jarhit");
  assert.strictEqual(await jars.count(), 15, "fifteen kinds of campus issues");
  assert.strictEqual(await page.locator("#coins-left").textContent(), "25 coins left");
  for (let i = 0; i < 4; i++) await jars.nth(0).click();
  for (let i = 0; i < 3; i++) await jars.nth(1).click();
  await page.locator("#jars .minus").nth(1).click();
  if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot + "-coins-spent.png") });
  await next(page);
  await at(page, "worksWell", shot);
  await page.click(btn("worksWell", "Everyone is already there"));
  await page.click(btn("worksWell", "Works with my load promo"));
  await next(page);
  await at(page, "wouldUse", shot);
  await page.click(btn("wouldUse", "Notices and deadlines in one place"));
  await page.click(btn("wouldUse", "Questions about my subjects"));
  await next(page);
  await at(page, "whoJoin", shot);
  await page.click(btn("whoJoin", "Faculty"));
  await page.click(btn("whoJoin", "Alumni"));
  await next(page);
  await at(page, "postPreference", shot);
  await page.click(btn("postPreference", "Under a made-up name other members can't link to me"));
  await at(page, "wantBack", shot);
  await page.click(btn("wantBack", "A fix, or a reason it can't be fixed"));
  await at(page, "whoRuns", shot);
  await page.click(btn("whoRuns", "Students, with VSU's support"));
  await at(page, "offLoad", shot);
  await page.click(btn("offLoad", "Yes, much more"));
  await at(page, "keepAway", shot);
  await page.click(btn("keepAway", "Uses too much mobile data"));
  await next(page);
  await at(page, "send", shot);
  await page.fill("#comment", "Will the results be shared with students?");
  await sendIt(page);
  await at(page, "final", shot);
}

function h_has_pins() { return receiver.headers_().some(k => /^pin\d/.test(k)); }
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
      const gate = await t.page.evaluate(() => document.querySelector('[data-step="consent"] .consent-list li').textContent);
      assert.ok(gate.indexOf("Skip any question") === 0, "the consent says any question can be skipped");
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
      assert.strictEqual(r.org, "A member, but I rarely take part");
      assert.strictEqual(r.transferee, "Yes");
      assert.strictEqual(r.wifiSpend, "₱200 to ₱499");
      assert.strictEqual(r.faculty, "Faculty of Engineering");
      assert.strictEqual(r.firstGen, "Yes");
      assert.deepStrictEqual(r.firstClasses, ["Group chats: class, org, friends", "In person: class or friends"]);
      assert.deepStrictEqual(r.firstSuspensions, ["Group chats: class, org, friends", "Official VSU pages or website"], "picks keep their order");
      assert.deepStrictEqual(r.firstDocuments, ["Official VSU pages or website"]);
      assert.deepStrictEqual(r.firstAnnouncements, ["Student council or org pages"]);
      assert.deepStrictEqual(r.firstEvents, ["Unofficial groups, like freedom walls"]);
      assert.deepStrictEqual(r.firstScholarships, ["Usually too late"]);
      assert.strictEqual(r.groupChats, "6 to 10");
      assert.deepStrictEqual(r.officialHow, ["Someone shares them with me"]);
      assert.deepStrictEqual(r.checkPost, ["Asked a friend or classmate"]);
      assert.strictEqual(r.whichOffice, "Registrar or records");
      assert.strictEqual(r.visitsTook, "Two or three");
      assert.strictEqual(r.missClass, "Yes, once");
      assert.deepStrictEqual(r.whyQuiet, [], "why you kept quiet comes only after Kept it to myself");
      for (const k of ["mainSource", "sources", "sourcesOther"]) assert.ok(!(k in r), "the record no longer carries " + k + " (D-119)");
      assert.ok(!("channelOrder" in r), "the channel order is fixed, so it is not recorded");
      assert.strictEqual(r.reachHow, "Messenger or another chat app");
      assert.strictEqual(r.reachGot, "Yes, but it took days");
      assert.deepStrictEqual(r.concern, ["Went to the student council or an org", "Used a suggestion box or feedback form"]);
      assert.strictEqual(r.askFirst, "A group chat");
      assert.deepStrictEqual(r.worksWell, ["Everyone is already there", "Works with my load promo"]);
      assert.strictEqual(rowOf(r)["firstScholarships 1"], "Usually too late");
      assert.strictEqual(rowOf(r)["firstSuspensions 2"], "Official VSU pages or website");
      assert.strictEqual(rowOf(r)["firstSuspensions 3"], "");
      assert.strictEqual(r.dataSpend, "₱99 or ₱100");
      assert.strictEqual(r.validity, "7 days");
      assert.strictEqual(r.untilExpiry, "No, it runs out early");
      assert.strictEqual(r.reload, "Yes, right away");
      assert.deepStrictEqual(r.reloadWhy, ["I still had app data, but needed other sites"]);
      assert.strictEqual(rowOf(r)["reloadWhy: I still had app data, but needed other sites"], true);
      assert.ok(!("dataRunsOut" in r), "running out is asked by the promo questions");
      assert.deepStrictEqual(r.twoSims, ["To switch when one has weak signal", "I pick each network's promo by need, like exam week"]);
      assert.strictEqual(r.dataSchool, "About half");
      assert.deepStrictEqual(r.networks, ["Smart", "DITO"]);
      assert.deepStrictEqual(r.load, ["Data for certain apps only", "Calls and texts"]);
      assert.deepStrictEqual(r.loadApps, ["Facebook and Messenger", "TikTok", "School apps, like Google Workspace, Zoom, or Canva"]);
      assert.strictEqual(r.signal, "On campus only");
      assert.deepStrictEqual(r.onlineCampus, ["Mobile data", "Campus Wi-Fi"]);
      assert.deepStrictEqual(r.onlineHome, ["Wi-Fi where I stay"]);
      assert.ok(!("online" in r), "the old online field is gone");
      assert.strictEqual(r.wantBack, "A fix, or a reason it can't be fixed");
      assert.strictEqual(Object.keys(r.board).length, 14);
      assert.ok(!("p" in r.board), "scene p is now a question");
      assert.ok(!("h" in r.board), "scene h is out");
      assert.deepStrictEqual(r.board.b, { often: "Often", matters: "Serious" });
      assert.deepStrictEqual(r.board.c, { often: "Never", matters: null });
      assert.ok(!("pins" in r), "the map is out for now");
      const coinTotal = Object.values(r.coins).reduce((a, b) => a + b, 0);
      assert.strictEqual(coinTotal, 6);
      assert.deepStrictEqual(r.coins, { online: 4, news: 2 });
      for (const k of ["story", "mayQuote", "trust", "postedAnonymously"]) assert.ok(!(k in r), k + " is gone");
      assert.strictEqual(r.concernHeard, "No, I never heard back");
      assert.deepStrictEqual(r.fbPosting, ["Yes, under a nickname", "Yes, anonymously"]);
      assert.strictEqual(r.whereFound, null);
      assert.deepStrictEqual(r.whoJoin, ["Faculty", "Alumni"]);
      assert.strictEqual(r.whoRuns, "Students, with VSU's support");
      assert.strictEqual(r.offLoad, "Yes, much more");
      assert.strictEqual(r.lunch, "Eateries near campus");
      assert.deepStrictEqual(r.cantGoOut, ["Ask a friend or classmate to buy it"]);
      assert.deepStrictEqual(r.buySell, ["Facebook groups or Marketplace"]);
      assert.strictEqual(r.postPreference, "Under a made-up name other members can't link to me");
      assert.deepStrictEqual(r.keepAway, ["Uses too much mobile data"]);
      assert.strictEqual(r.comment, "Will the results be shared with students?");
      const row = rowOf(r);
      assert.strictEqual(row["coins: online"], 4);
      assert.strictEqual(row["coins: health"], "");
      assert.strictEqual(row.concernHeard, "No, I never heard back");
      assert.strictEqual(row["fbPosting: Yes, anonymously"], true);
      assert.strictEqual(row["buySell: Facebook groups or Marketplace"], true);
      assert.strictEqual(row["whoJoin: Alumni"], true);
      assert.strictEqual(row.whoRuns, "Students, with VSU's support");
      assert.strictEqual(row.offLoad, "Yes, much more");
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
      assert.ok(!("p often" in row), "scene p has no columns");
      assert.strictEqual(row["e often"], "Often");
      assert.strictEqual(row["network: DITO"], true);
      assert.strictEqual(row["network: unlisted"], "");
      assert.strictEqual(row["load: Calls and texts"], true);
      assert.strictEqual(row["loadApps: TikTok"], true);
      assert.strictEqual(row.signal, "On campus only");
      assert.strictEqual(row.transport, "Habal-habal or tricycle");
      assert.strictEqual(row.transferee, "Yes");
      assert.strictEqual(row["wifiSpend (month)"], "₱200 to ₱499");
      assert.strictEqual(row["dataSpend (week)"], "₱99 or ₱100");
      assert.strictEqual(row["twoSims: I pick each network's promo by need, like exam week"], true);
      assert.strictEqual(row["firstAnnouncements 1"], "Student council or org pages");
      assert.strictEqual(row.groupChats, "6 to 10");
      assert.strictEqual(row["officialHow: Someone shares them with me"], true);
      assert.strictEqual(row["checkPost: Asked a friend or classmate"], true);
      assert.strictEqual(row.whichOffice, "Registrar or records");
      assert.strictEqual(row.visitsTook, "Two or three");
      assert.strictEqual(row.missClass, "Yes, once");
      assert.strictEqual(row["loadApps: School apps, like Google Workspace, Zoom, or Canva"], true);
      assert.strictEqual(row["onCampus: Campus Wi-Fi"], true);
      assert.strictEqual(row["whereStaying: Wi-Fi where I stay"], true);
      assert.strictEqual(row["whereStaying: unlisted"], "");
      assert.strictEqual(row.wantBack, "A fix, or a reason it can't be fixed");
      assert.ok(!h_has_pins(), "no pin columns");
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
      return { join: get("whoJoin", "whoJoin"), heard: get("concernHeard", "concernHeard"), fb: get("fbPosting", "fbPosting"), cant: get("cantGoOut", "cantGoOut"), buy: get("buySell", "buySell"), officialHow: get("officialHow", "officialHow"), checkPost: get("checkPost", "checkPost"), whyQuiet: get("whyQuiet", "whyQuiet"), reloadWhy: get("reloadWhy", "reloadWhy"), twoSims: get("twoSims", "twoSims"), networks: get("networks", "networks"), oc: get("onlineCampus", "onlineCampus"), oh: get("onlineHome", "onlineHome"), load: get("load", "load"), apps: get("loadApps", "loadApps"), concern: get("concern", "concern"), works: get("worksWell", "worksWell"), pull: get("wouldUse", "wouldUse"), away: get("keepAway", "keepAway"), moments: window.__survey.steps().filter(id => id.indexOf("m-") === 0).map(id => id.slice(2)) };
    });
    assert.deepStrictEqual(vals.concern.slice().sort(), receiver.CONCERN.slice().sort());
    assert.deepStrictEqual(vals.heard.slice().sort(), receiver.HEARD.slice().sort());
    assert.deepStrictEqual(vals.join.slice().sort(), receiver.WHO_JOIN.slice().sort());
    assert.deepStrictEqual(vals.fb.slice().sort(), receiver.FB_POSTING.slice().sort());
    assert.deepStrictEqual(vals.cant.slice().sort(), receiver.CANT_GO_OUT.slice().sort());
    assert.deepStrictEqual(vals.buy.slice().sort(), receiver.BUY_SELL.slice().sort());
    assert.deepStrictEqual(vals.officialHow.slice().sort(), receiver.OFFICIAL_HOW.slice().sort());
    assert.deepStrictEqual(vals.checkPost.slice().sort(), receiver.CHECK_POST.slice().sort());
    assert.deepStrictEqual(vals.whyQuiet.slice().sort(), receiver.WHY_QUIET.slice().sort());
    assert.deepStrictEqual(vals.works.slice().sort(), receiver.WORKS.slice().sort());
    assert.deepStrictEqual(vals.networks.slice().sort(), receiver.NETWORKS.slice().sort());
    assert.deepStrictEqual(vals.twoSims.slice().sort(), receiver.TWO_SIMS.slice().sort());
    assert.deepStrictEqual(vals.reloadWhy.slice().sort(), receiver.RELOAD_WHY.slice().sort());
    assert.deepStrictEqual(vals.oc.slice().sort(), receiver.ONLINE_CAMPUS.slice().sort());
    assert.deepStrictEqual(vals.oh.slice().sort(), receiver.ONLINE_HOME.slice().sort());
    assert.deepStrictEqual(vals.load.slice().sort(), receiver.LOAD.slice().sort());
    assert.deepStrictEqual(vals.apps.slice().sort(), receiver.LOAD_APPS.slice().sort());
    assert.deepStrictEqual(vals.pull.slice().sort(), receiver.WOULD_USE.slice().sort());
    assert.deepStrictEqual(vals.away.slice().sort(), receiver.AWAY.slice().sort());
    assert.deepStrictEqual(vals.moments.slice().sort(), receiver.MOMENTS.slice().sort());
    await t.ctx.close();
  });

  await check("skipping the networks still asks about load, and why two SIMs comes only with two", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    const steps = () => t.page.evaluate(() => window.__survey.steps());
    await t.page.evaluate(() => window.__survey.go("networks"));
    await at(t.page, "networks");
    assert.ok(!(await steps()).includes("twoSims"), "no networks, no question on two SIMs");
    await next(t.page);
    await at(t.page, "load");
    await t.page.evaluate(() => window.__survey.go("networks"));
    await at(t.page, "networks");
    await t.page.click(btn("networks", "Globe"));
    assert.ok(!(await steps()).includes("twoSims"), "one network, no question on two SIMs");
    await t.page.click(btn("networks", "TM"));
    assert.ok((await steps()).includes("twoSims"), "two networks bring the question");
    await next(t.page);
    await at(t.page, "twoSims");
    await t.page.click(btn("twoSims", "One for data, one for calls and texts"));
    await t.page.click(btn("twoSims", "No particular reason"));
    assert.deepStrictEqual(await t.page.evaluate(() => window.__survey.answers.twoSims), ["No particular reason"], "No particular reason stands alone");
    await t.page.evaluate(() => window.__survey.go("networks"));
    await at(t.page, "networks");
    await t.page.click(btn("networks", "TM"));
    assert.deepStrictEqual(await t.page.evaluate(() => window.__survey.answers.twoSims), [], "dropping to one network clears the reasons");
    assert.deepStrictEqual(t.errors, []);
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
    await at(t.page, "twoSims");
    await next(t.page);
    await at(t.page, "load");
    await t.page.click(btn("load", "Data for any site or app"));
    await next(t.page);
    await at(t.page, "validity");
    await next(t.page);
    await at(t.page, "dataSpend");
    assert.ok(!(await steps()).includes("untilExpiry"), "skipping validity skips the promo questions");
    await t.page.click(btn("dataSpend", "Under ₱49"));
    await at(t.page, "dataSchool");
    await t.page.click(btn("dataSchool", "Almost all"));
    await at(t.page, "signal");
    await t.page.click(btn("signal", "Where I stay only"));
    await t.page.evaluate(() => window.__survey.go("load"));
    await at(t.page, "load");
    await t.page.click(btn("load", "I don't use load"));
    let a = await ans();
    assert.deepStrictEqual([a.dataSpend, a.dataSchool, a.signal, a.validity], [null, null, null, null], "no load clears spending, validity, schoolwork, and signal");
    let L = await steps();
    for (const id of ["loadApps", "dataSpend", "validity", "untilExpiry", "reload", "reloadWhy", "dataSchool", "signal"]) assert.ok(!L.includes(id), id + " is skipped with no load");
    await next(t.page);
    await at(t.page, "onlineCampus");
    await t.page.evaluate(() => window.__survey.go("load"));
    await at(t.page, "load");
    await t.page.click(btn("load", "Calls and texts"));
    L = await steps();
    assert.ok(L.includes("dataSpend"), "calls and texts still cost load");
    for (const id of ["validity", "untilExpiry", "reload", "reloadWhy", "dataSchool", "signal"]) assert.ok(!L.includes(id), id + " is skipped with calls and texts only");
    await t.page.click(btn("load", "A postpaid plan"));
    L = await steps();
    for (const id of ["dataSpend", "dataSchool", "signal"]) assert.ok(L.includes(id), id + " is asked of a postpaid plan");
    await t.page.evaluate(() => window.__survey.go("dataSpend"));
    await at(t.page, "dataSpend");
    await t.page.click(btn("dataSpend", "Someone else pays for it"));
    assert.strictEqual((await ans()).dataSpend, "Someone else pays for it", "load someone else pays for is its own answer");
    L = await steps();
    for (const id of ["dataSchool", "signal"]) assert.ok(L.includes(id), id + " is still asked when someone else pays");
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
    for (let i = 0; i < 90 && (await current(t.page)) !== "send"; i++) {
      const before = await current(t.page);
      assert.strictEqual(await t.page.locator("#next-lbl").textContent(), "Skip", "the button says Skip on an unanswered step (" + before + ")");
      await next(t.page);
      await t.page.waitForFunction(x => window.__survey.current() !== x, before, { timeout: 5000 });
    }
    await at(t.page, "send");
    assert.ok((await t.page.locator("#skipped").textContent()).indexOf("You skipped") === 0);
    await sendIt(t.page);
    await at(t.page, "final");
    const r = JSON.parse(t.posts[0]);
    assert.strictEqual(r.residence, null);
    assert.deepStrictEqual(r.board, {});
    assert.ok(!("pins" in r));
    for (const k of ["transport", "groupChats", "whichOffice", "visitsTook", "reachHow", "reachGot", "missClass", "concernHeard", "askFirst", "wifiSpend", "whereFound", "lunch", "whoRuns", "offLoad"]) assert.strictEqual(r[k], null, k);
    for (const k of ["firstClasses", "firstSuspensions", "firstDocuments", "firstEvents", "firstScholarships", "firstAnnouncements", "officialHow", "checkPost", "whyQuiet", "fbPosting", "cantGoOut", "buySell", "whoJoin"]) assert.deepStrictEqual(r[k], [], k);
    for (const k of ["year", "faculty", "org", "scholarship", "transferee", "firstGen"]) assert.strictEqual(r[k], null, k + " can be skipped");
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
    await t.page.click('#menu [data-jump="coins"]');
    await at(t.page, "coins");
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
    await check("from home to the pass, " + (vp.width < 700 ? "the drawing stays in view and every answer can be scrolled to" : "every answer is in view without scrolling") + " at " + vp.width + "x" + vp.height, async () => {
      const mobile = vp.width < 700;
      const t = await open(browser, { viewport: vp, mobile, reduced: true });
      await t.page.click("#start");
      await at(t.page, "consent");
      await t.page.click(inStep("consent", ".agree"));
      await next(t.page);  // with reduced motion nothing moves on by itself
      await at(t.page, "home");
      for (const id of ["home", "transport", "year", "faculty", "org", "scholarship", "transferee", "firstGen"]) {
        await t.page.evaluate(x => window.__survey.go(x), id);
        await at(t.page, id);
        const hidden = await t.page.evaluate(({ id, mobile }) => {
          const p = document.querySelector('[data-step="' + id + '"]'), pr = p.getBoundingClientRect();
          const n = document.getElementById("next").getBoundingClientRect();
          const bottom = mobile ? Math.min(innerHeight - 84, n.top) : Math.min(pr.bottom, innerHeight);
          if (mobile) return window.phoneFit(p, bottom);
          return Array.from(p.querySelectorAll("[data-v]")).filter(e => { const b = e.getBoundingClientRect(); return b.bottom > bottom + 1 || b.top < pr.top - 1; }).map(e => e.dataset.v);
        }, { id, mobile });
        assert.deepStrictEqual(hidden, [], id + ": " + (mobile ? "drawing or reach" : "answers below the fold"));
      }
      await t.ctx.close();
    });
  }

  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 664 }, { width: 412, height: 720 }, { width: 390, height: 844 }, { width: 1366, height: 768 }]) {
    await check("from the news to Send, " + (vp.width < 700 ? "the drawing stays in view and every answer can be scrolled to" : "every answer is in view without scrolling") + " at " + vp.width + "x" + vp.height, async () => {
      const mobile = vp.width < 700;
      const t = await open(browser, { viewport: vp, mobile, reduced: true });
      await t.page.click("#start");
      await at(t.page, "consent");
      await t.page.click(inStep("consent", ".agree"));
      await next(t.page);  // with reduced motion nothing moves on by itself
      await at(t.page, "home");
      const fold = ({ id, mobile }) => {
        const p = document.querySelector('[data-step="' + id + '"]'), pr = p.getBoundingClientRect();
        const n = document.getElementById("next"), nr = n.getBoundingClientRect();
        const bottom = mobile ? Math.min(innerHeight - 84, n.hidden ? innerHeight : nr.top) : Math.min(pr.bottom, innerHeight);
        if (mobile) return window.phoneFit(p, bottom);
        return Array.from(p.querySelectorAll("[data-v], textarea, #send")).filter(e => e.offsetParent !== null && true).filter(e => { const b = e.getBoundingClientRect(); return b.bottom > bottom + 1 || b.top < pr.top - 1; }).map(e => e.dataset.v || e.id);
      };
      // Nine scenes happened; the coins step shows its fifteen jars either way.
      const scenes = (await t.page.evaluate(() => window.__survey.steps())).filter(x => x.startsWith("m-"));
      await t.page.evaluate(() => { const a = window.__survey.answers; a.load = ["Data for certain apps only"]; a.networks = ["Smart", "DITO"]; a.validity = "7 days"; a.untilExpiry = "No, it runs out early"; a.reload = "Yes, right away";
        a.board.o = { often: "Several times", matters: null }; a.scenario = "Walked over and asked around"; a.reachHow = "Email"; a.concern = ["Told the office directly"]; a.residence = "An on-campus dorm";
        a.firstClasses = ["Unofficial groups, like freedom walls", "Group chats: class, org, friends", "Campus bulletin boards"]; });
      const ids = (await t.page.evaluate(() => window.__survey.steps())).filter(x => ["networks", "twoSims", "load", "loadApps", "dataSpend", "validity", "untilExpiry", "reload", "reloadWhy", "dataSchool", "signal", "onlineCampus", "onlineHome", "wifiSpend", "firstClasses", "firstSuspensions", "firstDocuments", "firstEvents", "firstScholarships", "firstAnnouncements", "groupChats", "officialHow", "checkPost", "scenario", "whichOffice", "visitsTook", "reachHow", "reachGot", "missClass", "concern", "whyQuiet", "concernHeard", "askFirst", "fbPosting", "whereFound", "lunch", "cantGoOut", "buySell", "coins", "worksWell", "wouldUse", "whoJoin", "postPreference", "wantBack", "whoRuns", "offLoad", "keepAway", "send"].indexOf(x) >= 0 || x.startsWith("m-"));
      for (const id of ids) {
        await t.page.evaluate(x => window.__survey.go(x), id);
        await at(t.page, id);
        if (id.startsWith("m-")) {
          // "Once or twice" for the first nine scenes, "It never happened" after; the follow-up must fit too.
          await t.page.click(inStep(id, '[data-key^="often"] .chip:nth-child(' + (scenes.indexOf(id) < 9 ? 2 : 1) + ")"));
          await t.page.evaluate(x => window.__survey.go(x), id);
        }
        assert.deepStrictEqual(await t.page.evaluate(fold, { id, mobile }), [], id + ": " + (mobile ? "drawing or reach" : "answers below the fold"));
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
    await next(t.page);  // with reduced motion nothing moves on by itself
    await at(t.page, "home");
    assert.ok((await t.page.locator(".how span").textContent()).indexOf("then Next") > 0, "the intro says to tap Next");
    await t.page.click(btn("home", "An on-campus dorm"));
    await t.page.waitForTimeout(1300);
    assert.strictEqual(await current(t.page), "home", "with reduced motion, an answer doesn't move the page on by itself");
    await next(t.page);
    await at(t.page, "transport");
    await t.page.evaluate(() => window.__survey.go("firstGen"));
    await at(t.page, "firstGen");
    await t.page.click(btn("firstGen", "No"));
    await next(t.page);
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
    for (const p of ["Mornings", "Your form", "Getting online", "Hearing from campus", "Reaching out", "Students and alumni", "Daily life"]) assert.ok(parts.includes(p), p + " is a part");
    for (const p of ["Campus life", "Your story"]) assert.ok(!parts.includes(p), p + " is gone");
    for (const p of ["Home", "Mobile data", "News", "Errand", "Scenes", "Trust", "Map"]) assert.ok(!parts.includes(p), p + " is no longer a part");
    assert.ok(/^\d+% answered$/.test(await t.page.locator("#menu-total").textContent()), "the menu shows how much is answered");
    assert.ok(await t.page.locator(".menu-list .mbar").count() >= 7, "each part shows its progress");
    await t.page.keyboard.press("Escape");
    assert.ok(!(await steps()).includes("reachGot"), "Did you get what you needed? waits for how you tried");
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
    assert.ok(!(await steps()).includes("whyQuiet"));
    await t.page.click(btn("concern", "Kept it to myself"));
    assert.ok((await steps()).includes("whyQuiet"), "Kept it to myself brings why");
    await t.page.evaluate(() => window.__survey.go("whyQuiet"));
    await at(t.page, "whyQuiet");
    await t.page.click(btn("whyQuiet", "I worried about the consequences"));
    await t.page.evaluate(() => window.__survey.go("concern"));
    await at(t.page, "concern");
    await t.page.click(btn("concern", "Told the office directly"));
    assert.deepStrictEqual((await ans()).whyQuiet, [], "telling someone clears why it was kept");
    assert.ok((await steps()).includes("concernHeard"), "a concern raised brings whether they heard back");
    assert.ok(!(await steps()).includes("whyQuiet"));
    // Answers that fit the earlier answer (D-129)
    const shown = id => t.page.locator(inStep(id, "[data-v]")).evaluateAll(bs => bs.filter(b => !b.hidden).map(b => b.dataset.v));
    await t.page.evaluate(() => { window.__survey.answers.residence = "A boarding house or apartment near campus"; window.__survey.go("whereFound"); });
    await at(t.page, "whereFound");
    let opts = await shown("whereFound");
    assert.ok(!opts.includes("Applied for a VSU dorm") && opts.includes("A sign or tarpaulin outside"), "a renter sees no dorm application");
    await t.page.evaluate(() => window.__survey.go("home"));
    await at(t.page, "home");
    await t.page.click(btn("home", "An on-campus dorm"));
    await t.page.evaluate(() => window.__survey.go("whereFound"));
    await at(t.page, "whereFound");
    opts = await shown("whereFound");
    assert.ok(opts.includes("Applied for a VSU dorm") && !opts.includes("A sign or tarpaulin outside") && !opts.includes("Walking around and asking"), "a dorm resident sees the dorm application, not signs");
    await t.page.click(btn("whereFound", "Applied for a VSU dorm"));
    await t.page.evaluate(() => window.__survey.go("home"));
    await at(t.page, "home");
    await t.page.click(btn("home", "A boarding house or apartment near campus"));
    assert.strictEqual((await ans()).whereFound, null, "an answer that no longer fits is taken back");
    await t.page.click(btn("home", "A relative's or friend's house"));
    assert.ok(!(await steps()).includes("whereFound"), "no finding where you stay at a relative's or friend's house");
    await t.page.evaluate(() => { const a = window.__survey.answers; a.load.length = 0; a.load.push("Data for any site or app"); a.validity = "7 days"; a.untilExpiry = "No, it runs out early"; a.reload = "Yes, right away"; window.__survey.go("reloadWhy"); });
    await at(t.page, "reloadWhy");
    opts = await shown("reloadWhy");
    assert.ok(!opts.includes("I still had app data, but needed other sites") && opts.includes("Schoolwork couldn't wait"), "no app-data reasons without app data");
    // The new-office question's follow-ups
    await t.page.evaluate(() => window.__survey.go("scenario"));
    await at(t.page, "scenario");
    assert.ok(!(await steps()).includes("whichOffice"), "which office waits for the new-office question");
    await t.page.click(btn("scenario", "Walked over and asked around"));
    await at(t.page, "whichOffice");
    await t.page.click(btn("whichOffice", "Cashier or accounting"));
    await at(t.page, "visitsTook");
    await t.page.evaluate(() => window.__survey.go("scenario"));
    await at(t.page, "scenario");
    await t.page.click(btn("scenario", "It hasn't happened to me"));
    let a = await ans();
    assert.deepStrictEqual([a.whichOffice, a.visitsTook], [null, null], "It hasn't happened clears the office follow-ups");
    assert.ok(!(await steps()).includes("whichOffice") && !(await steps()).includes("visitsTook"));
    // Ranking the channels
    await t.page.evaluate(() => window.__survey.go("firstClasses"));
    await at(t.page, "firstClasses");
    for (const c of ["Email or text message", "Group chats: class, org, friends", "Campus bulletin boards", "In person: class or friends"]) await t.page.click(btn("firstClasses", c));
    assert.deepStrictEqual((await ans()).firstClasses, ["Email or text message", "Group chats: class, org, friends", "Campus bulletin boards"], "at most three, in the order picked");
    await t.page.click(btn("firstClasses", "Email or text message"));
    assert.deepStrictEqual((await ans()).firstClasses, ["Group chats: class, org, friends", "Campus bulletin boards"], "taking one back moves the rest up");
    assert.strictEqual(await t.page.locator(btn("firstClasses", "Group chats: class, org, friends")).getAttribute("data-rank"), "1st");
    assert.strictEqual(await t.page.locator(btn("firstClasses", "Email or text message")).getAttribute("data-rank"), null);
    await t.page.click(btn("firstClasses", "I don't hear about it"));
    assert.deepStrictEqual((await ans()).firstClasses, ["I don't hear about it"], "I don't hear about it stands alone");
    await t.page.click(btn("firstClasses", "Official VSU pages or website"));
    assert.deepStrictEqual((await ans()).firstClasses, ["Official VSU pages or website"], "and gives way to a channel");
    assert.strictEqual(await current(t.page), "firstClasses", "picking a channel doesn't move on by itself");
    // Checking a post follows the official-or-not scene
    assert.ok(!(await steps()).includes("checkPost"));
    await t.page.evaluate(() => window.__survey.go("m-o"));
    await at(t.page, "m-o");
    await t.page.click(inStep("m-o", '[data-key="often:o"] [data-v="Often"]'));
    assert.ok((await steps()).includes("checkPost"), "a post that couldn't be told apart brings how it was checked");
    await t.page.evaluate(() => window.__survey.go("checkPost"));
    await at(t.page, "checkPost");
    await t.page.click(btn("checkPost", "Asked a friend or classmate"));
    await t.page.click(btn("checkPost", "I didn't check"));
    assert.deepStrictEqual((await ans()).checkPost, ["I didn't check"], "I didn't check stands alone");
    await t.page.evaluate(() => window.__survey.go("m-o"));
    await at(t.page, "m-o");
    await t.page.click(inStep("m-o", '[data-key="often:o"] [data-v="Never"]'));
    assert.deepStrictEqual((await ans()).checkPost, [], "it never happening clears how it was checked");
    await t.page.evaluate(() => window.__survey.go("worksWell"));
    await at(t.page, "worksWell");
    await t.page.click(btn("worksWell", "Nothing much"));
    await t.page.click(btn("worksWell", "News spreads fast"));
    assert.deepStrictEqual((await ans()).worksWell, ["News spreads fast"], "Nothing much gives way to a pick");
    await t.page.evaluate(() => { window.__survey.answers.residence = "My family's home, and I commute"; });
    await t.page.evaluate(() => window.__survey.go("m-i"));
    await at(t.page, "m-i");
    assert.strictEqual((await ans()).board.i.often, "Does not apply", "a student who commutes from home starts at Doesn't apply on housing");
    assert.strictEqual((await ans()).board.i.prefilled, true, "and the record says it was picked for them");
    assert.ok(await t.page.locator(inStep("m-i", ".note.prefill")).isVisible(), "the screen says it was picked for them");
    assert.strictEqual(receiver.row_({ board: { i: { often: "Does not apply", prefilled: true } } }, new Date())[receiver.headers_().indexOf("i prefilled")], true);
    await t.page.click(inStep("m-i", '[data-key="often:i"] [data-v="Once or twice"]'));
    assert.ok(!("prefilled" in (await ans()).board.i), "a tap makes it the student's own answer");
    assert.ok(await t.page.locator(inStep("m-i", ".note.prefill")).isHidden());
    assert.ok((await t.page.locator(inStep("m-i", ".q")).first().textContent()).startsWith("Since the start of this semester, how often has"), "scenes ask since the start of this semester");
    assert.strictEqual(await t.page.locator('[data-box="m-i"] .cal-marks').count(), 0, "no calendar on the scenes");
    const order = (await steps()).filter(x => x.startsWith("m-")).map(x => x.slice(2)).join("");
    assert.strictEqual(order, "dofgkacbnelijm", "scenes follow the parts, after each part's questions");
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
    assert.strictEqual(await t.page.locator(btn("faculty", "Prefer not to say")).count(), 0, "no Prefer not to say in Your form");
    await next(t.page);
    await at(t.page, "org");
    assert.ok(/\bskip\b/.test(await bar(1)), "a skip is typed in as a short grey line");
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

  await check("the promo questions follow from one another, and clear when ruled out", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "home");
    const steps = () => t.page.evaluate(() => window.__survey.steps());
    const ans = () => t.page.evaluate(() => window.__survey.answers);
    await t.page.evaluate(() => { window.__survey.answers.load.push("Data for any site or app"); window.__survey.go("validity"); });
    await at(t.page, "validity");
    assert.strictEqual(await t.page.locator(btn("validity", "Regular load, no promo")).count(), 0);
    await t.page.click(btn("validity", "15 days"));
    await at(t.page, "untilExpiry");
    let L = await steps();
    assert.ok(L.includes("reload") && L.includes("reloadWhy"), "until answered, the reload questions count as coming");
    await t.page.click(btn("untilExpiry", "It varies"));
    L = await steps();
    assert.ok(!L.includes("reload") && !L.includes("reloadWhy"), "only data that runs out early brings the reload questions");
    await t.page.evaluate(() => window.__survey.go("untilExpiry"));
    await at(t.page, "untilExpiry");
    await t.page.click(btn("untilExpiry", "No, it runs out early"));
    await at(t.page, "reload");
    assert.strictEqual(await t.page.locator(btn("reload", "No, I connect to someone else's hotspot")).count(), 1, "someone else's hotspot is offered");
    await t.page.click(btn("reload", "Yes, right away"));
    await at(t.page, "reloadWhy");
    assert.ok(await t.page.locator(btn("reloadWhy", "I still had data for any site, but wanted more app data")).isHidden(), "app-data reasons wait for app data");
    await t.page.click(btn("reloadWhy", "Schoolwork couldn't wait"));
    await t.page.evaluate(() => window.__survey.go("reload"));
    await at(t.page, "reload");
    await t.page.click(btn("reload", "No, I connect to someone else's hotspot"));
    assert.deepStrictEqual((await ans()).reloadWhy, [], "not reloading clears the reasons for reloading");
    assert.ok(!(await steps()).includes("reloadWhy"));
    await t.page.evaluate(() => window.__survey.go("validity"));
    await at(t.page, "validity");
    await t.page.click(btn("validity", "15 days"));
    let a = await ans();
    assert.deepStrictEqual([a.validity, a.untilExpiry, a.reload], [null, null, null], "taking back validity clears the promo questions");
    L = await steps();
    for (const id of ["untilExpiry", "reload", "reloadWhy"]) assert.ok(!L.includes(id), id + " is skipped without a promo");
    await t.page.click(btn("validity", "7 days"));
    await at(t.page, "untilExpiry");
    await next(t.page);
    await at(t.page, "dataSpend");
    L = await steps();
    assert.ok(L.includes("untilExpiry") && !L.includes("reload"), "a skipped question drops its follow-ups");
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
