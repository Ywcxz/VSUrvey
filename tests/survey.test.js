/*
 * Walks VSUrvey in a headless browser with made-up answers, then checks
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
/* The pages are served under the live security policy in vercel.json, with the hash of the script actually served (the tests
   change it, to open the page), so anything the policy would block in production fails here too. */
const csp = require("../scripts/csp.js");
const POLICY = csp.current();
const CSP_WATCH = 'window.__csp = []; document.addEventListener("securitypolicyviolation", function (e) { window.__csp.push(e.violatedDirective + " " + (e.blockedURI || "inline")); });';
const policyFor = html => POLICY.replace(csp.hashes(HTML)[0], csp.hashes(html)[0]);
const PROD = "https://survey.projectcampus.org/";
const VERCEL_PROD = "https://project-campus-vsurvey.vercel.app/";
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
/* The site's own files, the bundled fonts and the 3D scripts, come from the repository; any other address on the site is the page. */
const TYPES = { woff2: "font/woff2", js: "text/javascript; charset=utf-8" };
function siteFile(u) {
  const m = /^https:\/\/[^/]+\/((?:fonts|js)\/[\w.-]+\.(woff2|js))$/.exec(u.split("?")[0]);
  const f = m && path.join(__dirname, "..", m[1]);
  return f && fs.existsSync(f) ? { status: 200, contentType: TYPES[m[2]], body: fs.readFileSync(f) } : null;
}
/* The page draws in 3D only with a graphics card, and turns down drawing in software, which is all a test machine may have:
   SOFT_GL lets software drawing count, NO_GL takes WebGL 2 away, and NET sets what the browser says about the connection. */
const SOFT_GL = 'var gc = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, o) { return gc.call(this, t, o && Object.assign({}, o, { failIfMajorPerformanceCaveat: false })); };';
const NO_GL = 'var gc = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, o) { return t === "webgl2" ? null : gc.call(this, t, o); };';
const NET = c => 'Object.defineProperty(navigator, "connection", { configurable: true, value: ' + JSON.stringify(c) + " });";
async function open(browser, o = {}) {
  const mobile = !!o.mobile;
  const ctx = await browser.newContext({ viewport: o.viewport || (mobile ? PHONE : DESKTOP), hasTouch: mobile, isMobile: mobile, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  await page.addInitScript(PHONE_FIT);
  await page.addInitScript(CSP_WATCH);
  for (const init of [].concat(o.init || [])) await page.addInitScript(init);
  const posts = [], errors = [], asked = [];
  page.on("request", r => asked.push(r.url()));
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route("**/*", route => {
    const req = route.request(), u = req.url();
    if (u.startsWith(PROD) || u.startsWith(VERCEL_PROD) || u.startsWith(OLD_PROD) || u.startsWith(PREVIEW)) return route.fulfill(siteFile(u) || { status: 200, contentType: "text/html; charset=utf-8", headers: { "Content-Security-Policy": policyFor(o.closed ? HTML : HTML_OPEN) }, body: o.closed ? HTML : HTML_OPEN });
    if (u.startsWith("https://script.google.com/")) { posts.push(req.postData()); return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); }
    return route.abort();
  });
  await page.goto((o.host || PROD) + (o.query || ""));
  return { ctx, page, posts, errors, asked };
}
/* What a page asked for from js/, the 3D moments' folder. */
const from3d = t => t.asked.map(u => u.replace(/^https:\/\/[^/]+\//, "").split("?")[0]).filter(u => u.indexOf("js/") === 0);

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

/* Picks a single answer that moves on by itself, then waits for the next step. */
async function one(page, id, v, shot) { await at(page, id, shot); await page.click(btn(id, v)); }
/* Picks one or more answers on a multi-pick screen, then Next. */
async function many(page, id, vs, shot) { await at(page, id, shot); for (const v of vs) await page.click(btn(id, v)); await next(page); }

/* The answers a screen offers this respondent, in order. */
const offered = (page, id) => page.locator(inStep(id, "[data-v]")).evaluateAll(bs => bs.filter(b => b.offsetParent !== null).map(b => b.dataset.v));

/* The whole walk with made-up answers, in one go. In a VSU dorm the respondent is asked which part of campus; otherwise, which
   barangay, and how they get to campus. */
async function walkAll(page, shot, dorm) {
  await at(page, "intro", shot);
  assert.ok((await page.locator(".startrow .note").textContent()).includes("20–25 minutes"), "the start says how long the survey takes");
  await page.click("#start");
  await at(page, "consent", shot);
  await page.click(inStep("consent", ".agree"));
  // Your form, at the reception desk, in the printed form's order: year, faculty and department, where you live, then orgs
  await at(page, "year", shot);
  assert.strictEqual(await page.locator(inStep("year", ".kicker")).textContent(), "Year", "each question has a label, not a number");
  assert.strictEqual(await page.locator(inStep("year", "h2")).textContent(), "What's your year level?");
  assert.strictEqual(await page.locator(btn("year", "Graduate student")).count(), 0, "undergraduates only");
  assert.ok(await page.locator('[data-box="pass"]').isVisible(), "asked at the reception desk");
  await page.click(btn("year", "2nd"));
  await one(page, "faculty", "Faculty of Engineering", shot);
  await at(page, "program", shot);
  assert.strictEqual(await page.locator(inStep("program", ".kicker")).textContent(), "Follow-upProgram");
  assert.deepStrictEqual(await offered(page, "program"), ["BS Agricultural and Biosystems Engineering", "BS Civil Engineering", "BS Geodetic Engineering", "BS Mechanical Engineering"], "only the faculty's own Main Campus programs, with Meteorology under Natural and Mathematical Sciences");
  assert.strictEqual(await page.locator('#passcard [data-f="program"]').textContent(), "", "the program line stays blank until the program is answered or skipped");
  assert.strictEqual(await page.locator(inStep("program", ".recap .ra")).textContent(), "Faculty of Engineering", "a follow-up keeps the answer it follows in view");
  await page.click(btn("program", "BS Mechanical Engineering"));
  await at(page, "home", shot);
  assert.strictEqual(await page.locator(inStep("home", ".kicker")).textContent(), "Where you live");
  assert.strictEqual(await page.locator(inStep("home", "h2")).textContent(), "Where do you currently reside?");
  if (dorm) {
    await page.click(btn("home", "An on-campus dorm"));
    await at(page, "dormPart", shot);
    assert.strictEqual(await page.locator(inStep("dormPart", ".kicker")).textContent(), "Follow-upWhere on campus");
    assert.deepStrictEqual(await offered(page, "dormPart"), ["Upper campus", "Lower campus"], "upper campus first");
    assert.ok(!(await page.evaluate(() => window.__survey.steps())).includes("barangay"), "no barangay for a VSU dorm");
    await page.click(btn("dormPart", "Upper campus"));
  } else {
    await page.click(btn("home", "A relative's or friend's house"));
    await at(page, "barangay", shot);
    assert.strictEqual(await page.locator(inStep("barangay", ".kicker")).textContent(), "Follow-upWhere you reside");
    assert.deepStrictEqual(await offered(page, "barangay"), ["Pangasugan", "Guadalupe (Utod)", "Marcos or San Agustin", "Patag or Gabas", "Bunga, or farther north in Baybay", "Kilim, or farther south in Baybay", "Outside of Baybay"], "the owner's order");
    await page.click(btn("barangay", "Guadalupe (Utod)"));
  }
  await at(page, "org", shot);
  assert.ok((await page.locator(inStep("org", ".lede")).textContent()).includes("Don't count the USSC"), "the student council every student belongs to isn't counted");
  await page.click(btn("org", dorm ? "An officer or leader" : "A member, but I rarely take part"));
  await at(page, "orgKinds", shot);
  assert.strictEqual(await page.locator(inStep("orgKinds", ".kicker")).textContent(), "Follow-upKinds of orgs");
  await many(page, "orgKinds", ["A course or department org", "Sports"], shot);
  if (dorm) {
    await at(page, "orgRun", shot);
    assert.strictEqual(await page.locator(inStep("orgRun", "h2")).textContent(), "What's hardest about running the org?");
    assert.deepStrictEqual(await page.locator(inStep("orgRun", ".recap .ra")).allTextContents(), ["An officer or leader", "A course or department org \u2022 Sports"], "a follow-up of a follow-up keeps both questions before it in view");
    await many(page, "orgRun", ["Passing things on to the next officers"], shot);
  } else {
    await at(page, "orgWhy", shot);
    assert.strictEqual(await page.locator(inStep("orgWhy", ".kicker")).textContent(), "Follow-upTaking more part");
    await many(page, "orgWhy", ["It's hard to connect with the members", "Its activities don't interest me"], shot);
  }
  const O = await page.evaluate(() => window.__survey.steps());
  assert.deepStrictEqual(["orgRun", "orgKeep", "orgWhy", "orgNone"].filter(k => O.includes(k)), [dorm ? "orgRun" : "orgWhy"], "one follow-up for each level of involvement");
  await at(page, "support", shot);
  assert.strictEqual(await page.locator(inStep("support", "h2")).textContent(), "How do you get by financially right now?");
  await many(page, "support", dorm ? ["A scholarship or financial aid"] : ["My parents or guardians send me money", "I work while studying"], shot);
  await at(page, "familyVSU", shot);
  const L = await page.evaluate(() => window.__survey.steps());
  for (const k of ["transport", "transferee", "firstGen", "scholarship"]) assert.ok(!L.includes(k), k + " is gone from Your form");
  assert.strictEqual(await page.locator(inStep("familyVSU", ".kicker")).textContent(), "Family at VSU", "asked of everyone, so not tagged as a follow-up");
  assert.deepStrictEqual(await offered(page, "familyVSU"), ["Yes, a parent or guardian", "Yes, a brother or sister", "Yes, another relative", "No, I'm the first in my family to study at VSU", "Not sure"]);
  await page.click(btn("familyVSU", dorm ? "Yes, a brother or sister" : "No, I'm the first in my family to study at VSU"));
  const card = await page.locator("#passcard dt").evaluateAll(ds => ds.map(d => d.textContent));
  assert.deepStrictEqual(card, ["Year", "Program", "Resides", "Scholar"], "the form's lines, in order");
  assert.strictEqual(await page.locator('#passcard [data-f="program"]').textContent(), "BS Mechanical Engineering");
  assert.deepStrictEqual(await page.locator('[data-box="pass"] .mon-v').allTextContents(), ["2nd year", "BSME", dorm ? "Upper campus dorm" : "Guadalupe (Utod)", dorm ? "Yes" : "No"], "the monitor shows the form being filled in");
  assert.strictEqual(await page.locator('#passcard [data-f="residence"]').textContent(), dorm ? "Upper campus dorm" : "Guadalupe (Utod)", "off campus, the form shows the barangay");
  assert.strictEqual(await page.locator('#passcard [data-f="scholar"]').textContent(), dorm ? "Yes" : "No", "the scholar line reads Yes or No from how you get by");
  if (SHOTS && shot) { await page.waitForTimeout(1700); await page.screenshot({ path: path.join(SHOTS, shot + "-familyVSU-printed.png") }); }
  // Getting online
  await at(page, "networks", shot);
  assert.strictEqual(await page.locator(btn("networks", "I don't use a SIM")).count(), 0, "no SIM means skipping the question");
  assert.strictEqual(await page.locator(inStep("networks", ".lede")).textContent(), "Pick up to two. Skip this if you don't use mobile data.");
  await page.click(btn("networks", "Smart"));
  await page.click(btn("networks", "DITO"));
  await next(page);
  await at(page, "twoSims", shot);
  assert.strictEqual(await page.locator(inStep("twoSims", "h2")).textContent(), "Why do you use two networks?");
  await many(page, "twoSims", ["To switch when one has weak signal", "I pick each network's promo by need, like exam week"], shot);
  await one(page, "dataSpend", "₱99 or ₱100", shot);
  await at(page, "dataUse", shot);
  assert.deepStrictEqual(await page.locator(inStep("dataUse", ".grp")).allTextContents(), ["Social", "Messaging", "Video and streaming", "Games", "School", "AI", "Open access"], "grouped by the kind of promo package");
  for (const v of ["Google Classroom", "AI apps, like ChatGPT or Gemini", "Browsing websites and searching"]) assert.strictEqual(await page.locator(btn("dataUse", v)).count(), 1, v + " is offered");
  await many(page, "dataUse", ["Facebook and Messenger", "TikTok", "Google Classroom", "AI apps, like ChatGPT or Gemini", "Browsing websites and searching"], shot);
  await at(page, "untilExpiry", shot);
  assert.strictEqual(await page.locator(inStep("untilExpiry", ".kicker")).textContent(), "Data allocation");
  const G = await page.evaluate(() => window.__survey.steps());
  for (const k of ["load", "loadApps", "validity"]) assert.ok(!G.includes(k), k + " is gone");
  await page.click(btn("untilExpiry", "No, it runs out early"));
  await at(page, "reload", shot);
  assert.strictEqual(await page.locator(inStep("reload", ".kicker")).textContent(), "Follow-upAnother promo");
  await page.click(btn("reload", "Yes, right away"));
  await at(page, "reloadWhy", shot);
  await page.click(btn("reloadWhy", "My open-access data ran out, but my app-only data didn't"));
  await page.click(btn("reloadWhy", "My app-only data ran out, but my open-access data didn't"));
  await page.click(btn("reloadWhy", "Both ran out"));
  await page.click(btn("reloadWhy", "My open-access data ran out, but my app-only data didn't"));
  assert.strictEqual(await page.locator(inStep("reloadWhy", ".recap .rq")).count(), 2, "both questions before it in view");
  await next(page);
  await at(page, "dataSchool", shot);
  assert.strictEqual(await page.locator(inStep("dataSchool", ".kicker")).textContent(), "Data for acads");
  await page.click(btn("dataSchool", "About half"));
  await one(page, "signal", "On campus only", shot);
  await at(page, "onlineCampus", shot);
  assert.strictEqual(await page.locator(inStep("onlineCampus", "h2")).textContent(), "On campus, how do you get online?");
  assert.ok((await page.locator(inStep("onlineCampus", ".lede")).textContent()).includes("Dorm Wi‑Fi counts as campus Wi‑Fi"));
  await many(page, "onlineCampus", ["Mobile data", "Campus Wi-Fi"], shot);
  await at(page, "onlineHome", shot);
  assert.strictEqual(await page.locator(btn("onlineHome", "Pocket Wi-Fi")).count(), 0, "pocket Wi-Fi is mobile data");
  await many(page, "onlineHome", ["Wi-Fi where I reside"], shot);
  await one(page, "wifiSpend", "₱200 to ₱499", shot);
  // Hearing from campus: six ranked news questions, two habits, then what has happened since starting at VSU
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
  await many(page, "firstDocuments", ["Official VSU pages or website"], shot);
  await at(page, "firstEvents", shot);
  assert.strictEqual(await page.locator(inStep("firstEvents", ".none-row .chip")).count(), 3, "events also offer I don't look for these");
  await many(page, "firstEvents", ["Unofficial groups, like freedom walls"], shot);
  await many(page, "firstScholarships", ["Usually too late"], shot);
  await many(page, "firstAnnouncements", ["Student council or org pages"], shot);
  await one(page, "groupChats", "6 to 10", shot);
  await many(page, "officialHow", ["Someone shares them with me"], shot);
  await at(page, "classNews", shot);
  assert.strictEqual(await page.locator(inStep("classNews", ".statement")).count(), 0, "no scene statements");
  assert.strictEqual(await page.locator(inStep("classNews", "h2")).textContent(), "When a class of yours was moved or cancelled, or the teacher didn't come, when did you find out?", "not only the last time, and no period in the question");
  assert.ok(!(await page.evaluate(() => document.body.textContent)).includes("Since you started at VSU,"), "the period is named once, on the first screen");
  assert.strictEqual(await page.locator(inStep("classNews", ".lede")).textContent(), "Pick all that have happened.");
  await many(page, "classNews", ["Before the class time", "Only after the class time"], shot);
  await many(page, "officialTell", ["Yes, right away", "I couldn't tell"], shot);
  await many(page, "checkPost", ["Asked a friend or classmate"], shot);
  await many(page, "missedLate", ["A scholarship or financial aid"], shot);
  // Reaching out
  await at(page, "scenario", shot);
  assert.strictEqual(await page.locator(inStep("scenario", ".kicker")).textContent(), "A new office");
  await page.click(btn("scenario", "Asked in a student Facebook group"));
  await page.click(btn("scenario", "Walked over and asked around"));
  await next(page);
  await at(page, "whichOffice", shot);
  assert.strictEqual(await page.locator(inStep("whichOffice", ".kicker")).textContent(), "Follow-upWhich office");
  await many(page, "whichOffice", ["Registrar or records", "Cashier or accounting"], shot);
  await at(page, "visitsTook", shot);
  assert.strictEqual(await page.locator(inStep("visitsTook", "h2")).textContent(), "How many tries did those errands take?");
  await many(page, "visitsTook", ["Just one", "Four or more"], shot);
  await at(page, "missClass", shot);
  assert.strictEqual(await page.locator(inStep("missClass", ".kicker")).textContent(), "Follow-upMissing class", "missing class follows the errands");
  assert.deepStrictEqual(await page.locator(inStep("missClass", ".recap .rq")).count(), 3, "with the new office, which offices, and the tries above it");
  assert.ok((await page.locator(inStep("missClass", ".recap .ra")).first().textContent()).includes(" \u2022 "), "answers picked are set apart with bullets");
  await page.click(btn("missClass", "Yes, once"));
  await at(page, "reachWhy", shot);
  assert.strictEqual(await page.locator(inStep("reachWhy", "h2")).textContent(), "Why have you needed to reach a teacher or staff member outside class?", "why, not how");
  await many(page, "reachWhy", ["A signature or a document", "A question about a lesson"], shot);
  await at(page, "reachHard", shot);
  assert.strictEqual(await page.locator(inStep("reachHard", ".kicker")).textContent(), "Follow-upWhat made it hard", "a follow-up of the reasons");
  await many(page, "reachHard", ["They didn't reply, or replied days later", "I hesitated to ask"], shot);
  await at(page, "concern", shot);
  const concernOrder = await page.locator(inStep("concern", "[data-v]")).evaluateAll(bs => bs.map(b => b.dataset.v));
  assert.strictEqual(concernOrder[0], "Kept it to myself", "Kept it to myself comes first");
  await page.click(btn("concern", "Kept it to myself"));
  await page.click(btn("concern", "Went to the student council or an org"));
  await page.click(btn("concern", "Used a suggestion box or feedback form"));
  await next(page);
  await many(page, "whyQuiet", ["I worried about the consequences"], shot);
  await at(page, "concernHeard", shot);
  assert.ok(await page.locator(inStep("concernHeard", ".kicker .fu")).isVisible(), "hearing back is tagged as a follow-up");
  await many(page, "concernHeard", ["Yes, and it was fixed", "No, I never heard back"], shot);
  // Students and alumni
  await at(page, "askFirst", shot);
  assert.strictEqual(await page.locator(btn("askFirst", "I didn't look or ask anyone")).count(), 1);
  await page.click(btn("askFirst", "A group chat"));
  await page.click(btn("askFirst", "A teacher or adviser"));
  await next(page);
  await many(page, "answerRight", ["They were right", "I couldn't tell"], shot);
  await many(page, "oldAnswer", ["Yes, quickly"], shot);
  await many(page, "guideSteps", ["I couldn't find a guide, so I figured it out"], shot);
  await many(page, "seniorFind", ["It hasn't happened"], shot);
  await at(page, "fbPosting", shot);
  assert.strictEqual(await page.locator(inStep("fbPosting", ".kicker")).textContent(), "Posting in unofficial Facebook groups");
  await many(page, "fbPosting", ["Yes, under a nickname", "Yes, anonymously"], shot);
  // Daily life: getting around, then how they get to campus if they live off it
  await at(page, "getAround", shot);
  assert.strictEqual(await page.locator(inStep("getAround", ".kicker")).textContent(), "Getting around");
  if (dorm) {
    await many(page, "getAround", ["A bicycle"], shot);
    assert.ok(!(await page.evaluate(() => window.__survey.steps())).includes("commute"), "no getting to campus from a VSU dorm");
    await one(page, "whereFound", "Applied for a VSU dorm", shot);
    await one(page, "housingSince", "No", shot);
  } else {
    await many(page, "getAround", ["I ride along with family, a relative, or a friend"], shot);
    await at(page, "commute", shot);
    assert.strictEqual(await page.locator(inStep("commute", ".kicker")).textContent(), "Follow-upGetting to campus");
    assert.deepStrictEqual(await offered(page, "commute"), ["Habal-habal", "Multicab", "Bus or van", "A ride with family, a relative, or a friend", "Walk"], "no vehicle of one's own when they have none");
    await many(page, "commute", ["Multicab", "Walk"], shot);
  }
  await at(page, "cantGoOut", shot);
  const D = await page.evaluate(() => window.__survey.steps());
  assert.strictEqual(D.includes("whereFound") && D.includes("housingSince"), dorm, dorm ? "a dorm is a place found" : "no finding a place at a relative's or friend's house");
  await many(page, "cantGoOut", ["Ask a friend or classmate to buy it"], shot);
  await at(page, "buySell", shot);
  assert.strictEqual(await page.locator(btn("buySell", "Online shops")).count(), 0, "online shops are not people on campus");
  await many(page, "buySell", ["Facebook groups or Marketplace"], shot);
  await one(page, "scamSince", "Nearly", shot);
  // The coins, after the questions that give the jars their context
  await at(page, "coins", shot);
  assert.ok(!(await page.evaluate(() => window.__survey.steps())).some(x => /Cost$/.test(x)), "no what-it-cost questions");
  const jars = page.locator("#jars .jarhit");
  const jar = k => page.locator('#jars .jarhit[data-v="' + k + '"]'), minus = k => page.locator('#jars .minus[data-v="' + k + '"]');
  assert.strictEqual(await page.locator(inStep("coins", "h2")).textContent(), "You have 25 coins. Which campus concerns would you like to get more attention?");
  assert.strictEqual(await jars.count(), 18, "eighteen campus concerns");
  const jarNames = await page.locator("#jars .lbl").evaluateAll(ls => ls.map(l => l.firstChild.textContent));
  for (const j of ["VSU's online services", "Basic facilities", "Grading and academic rules"]) assert.ok(jarNames.includes(j), j + " has a jar");
  assert.strictEqual(await page.locator("#coins-left").textContent(), "25 coins left");
  for (let i = 0; i < 12; i++) if (await jar("offices").isEnabled()) await jar("offices").click();
  assert.strictEqual(await page.locator("#coins-left").textContent(), "15 coins left", "a jar holds at most 10");
  assert.ok(await jar("offices").isDisabled(), "a full jar takes no more");
  for (let i = 0; i < 10; i++) await minus("offices").click();
  for (let i = 0; i < 4; i++) await jar("online").click();
  for (let i = 0; i < 3; i++) await jar("news").click();
  await minus("news").click();
  if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot + "-coins-spent.png") });
  await next(page);
  // Network idea
  await at(page, "worksWell", shot);
  assert.strictEqual(await page.locator(inStep("worksWell", "h2")).textContent(), "For VSU matters, what do Messenger GCs and Facebook groups do well?");
  assert.strictEqual(await page.locator(btn("wouldUse", "A verified marketplace")).count(), 1);
  assert.strictEqual(await page.locator(btn("whoJoin", "Parents, relatives, or friends")).count(), 1);
  await many(page, "worksWell", ["Everyone is already there", "Works with my load promo"], shot);
  await many(page, "wouldUse", ["Notices and deadlines in one place", "Questions about my subjects"], shot);
  await many(page, "whoJoin", ["Faculty", "Alumni"], shot);
  await at(page, "postPreference", shot);
  assert.strictEqual(await page.locator(btn("postPreference", "Without my name shown to other members")).count(), 1, "no promise that no one can ever link a post");
  await page.click(btn("postPreference", "Under a made-up name other members can't link to me"));
  await one(page, "wantBack", "A fix, or a reason it can't be fixed", shot);
  await one(page, "whoRuns", "Students, with VSU's support", shot);
  await one(page, "hostedPay", "Pay a small fee to use it on campus", shot);
  await many(page, "keepAway", ["Uses too much mobile data"], shot);
  await at(page, "send", shot);
  assert.strictEqual(await page.locator(inStep("send", "h2")).textContent(), "Anything we missed?", "Send goes straight to the comment");
  assert.strictEqual(await page.locator("#strip").count(), 0, "no summary panels");
  await page.fill("#comment", "Will the results be shared with students?");
  await sendIt(page);
  await at(page, "final", shot);
  assert.strictEqual(await page.locator("#story-link").getAttribute("href"), "https://docs.projectcampus.org/", "the thank-you link leads to what CAMPUS proposes");
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
  /* Every decision or evidence ID in the README and licence notes links to its row in the master doc. */
  await check("register IDs in the README and licence notes link to the master doc", async () => {
    for (const f of ["README.md", "LICENSE-CONTENT.md"]) {
      const plain = fs.readFileSync(path.join(__dirname, "..", f), "utf8")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]*`/g, "")
        .replace(/\[[DQCEP]-\d{2,3}\]\(https:\/\/docs\.projectcampus\.org\/(decisions|evidence)\.html#[dqcep]-\d{2,3}\)/g, "")
        .match(/\b[DQCEP]-\d{2,3}\b/g);
      assert(!plain, f + ": unlinked " + (plain || []).join(", "));
    }
  });

  await check("vercel.json's security policy allows exactly the pages' own scripts (if not: node scripts/csp.js)", async () => {
    assert.strictEqual(csp.current(), csp.policy(), "the security policy is out of date with the pages' scripts: run node scripts/csp.js");
    assert.ok(/connect-src https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com;/.test(POLICY), "answers may go only to the Apps Script receivers");
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(POLICY), "no inline script runs unless the policy names its hash");
  });

  /* Test machines have no graphics card: the switch lets the browser draw WebGL in software, which the 3D checks need. */
  const browser = await chromium.launch({ executablePath: EXE, args: ["--enable-unsafe-swiftshader"] });

  /* On a phone the respondent stays with a relative; on a computer, in a VSU dorm. */
  for (const [label, mobile, dorm] of [["phone", true, false], ["desktop", false, true]]) {
    await check("a full walk on " + label + (dorm ? ", from a VSU dorm," : ", from a relative's house,") + " sends one record", async () => {
      const t = await open(browser, { mobile });
      await walkAll(t.page, SHOTS ? label : "", dorm);
      await t.page.waitForTimeout(300);
      assert.deepStrictEqual(t.errors, []);
      assert.deepStrictEqual(await t.page.evaluate(() => window.__csp), [], "the security policy blocked something");
      assert.strictEqual(t.posts.length, 1, "expected 1 POST, got " + t.posts.length);
      const r = JSON.parse(t.posts[0]);
      assert.strictEqual(r.version, "since-v1");
      assert.strictEqual(r.variant, "since");
      assert.strictEqual(r.survey, "student-life-2026");
      for (const k of ["rid", "stage", "more", "transport", "transferee", "firstGen", "classLast", "officialLast", "reachHow", "reachGot", "guideLast", "seniorLast"]) assert.ok(!(k in r), k + " is gone");
      assert.deepStrictEqual(Object.keys(r).filter(k => /Cost$/.test(k)), [], "no what-it-cost answers");
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
      assert.strictEqual(r.residence, dorm ? "An on-campus dorm" : "A relative's or friend's house");
      assert.strictEqual(r.dormPart, dorm ? "Upper campus" : null);
      assert.strictEqual(r.barangay, dorm ? null : "Guadalupe (Utod)");
      assert.strictEqual(r.program, "BS Mechanical Engineering");
      assert.strictEqual(r.barangay, dorm ? null : "Guadalupe (Utod)");
      assert.strictEqual(r.org, dorm ? "An officer or leader" : "A member, but I rarely take part");
      assert.deepStrictEqual(r.orgKinds, ["A course or department org", "Sports"]);
      assert.deepStrictEqual(r.orgRun, dorm ? ["Passing things on to the next officers"] : []);
      assert.deepStrictEqual(r.orgWhy, dorm ? [] : ["It's hard to connect with the members", "Its activities don't interest me"]);
      assert.deepStrictEqual([r.orgKeep, r.orgNone], [[], []]);
      assert.deepStrictEqual(r.support, dorm ? ["A scholarship or financial aid"] : ["My parents or guardians send me money", "I work while studying"]);
      assert.ok(!("scholarship" in r), "the scholarship question is now how you get by");
      assert.strictEqual(r.faculty, "Faculty of Engineering");
      assert.strictEqual(r.familyVSU, dorm ? "Yes, a brother or sister" : "No, I'm the first in my family to study at VSU");
      assert.deepStrictEqual(r.coins, { online: 4, news: 2 });
      assert.deepStrictEqual(r.jarOrder.split(" ").sort(), receiver.JARS.slice().sort(), "the order the jars were shown in is sent");
      assert.strictEqual(rowOf(r).jarOrder, r.jarOrder);
      assert.deepStrictEqual(r.firstClasses, ["Group chats: class, org, friends", "In person: class or friends"]);
      assert.deepStrictEqual(r.firstSuspensions, ["Group chats: class, org, friends", "Official VSU pages or website"], "picks keep their order");
      assert.strictEqual(r.groupChats, "6 to 10");
      assert.deepStrictEqual(r.officialHow, ["Someone shares them with me"]);
      assert.deepStrictEqual(r.classNews, ["Before the class time", "Only after the class time"], "everything that happened, not only the last time");
      assert.deepStrictEqual(r.officialTell, ["Yes, right away", "I couldn't tell"]);
      assert.deepStrictEqual(r.checkPost, ["Asked a friend or classmate"]);
      assert.deepStrictEqual(r.missedLate, ["A scholarship or financial aid"]);
      assert.deepStrictEqual(r.scenario, ["Asked in a student Facebook group", "Walked over and asked around"]);
      assert.deepStrictEqual(r.whichOffice, ["Registrar or records", "Cashier or accounting"]);
      assert.deepStrictEqual(r.visitsTook, ["Just one", "Four or more"]);
      assert.deepStrictEqual(r.reachWhy, ["A signature or a document", "A question about a lesson"]);
      assert.deepStrictEqual(r.reachHard, ["They didn't reply, or replied days later", "I hesitated to ask"]);
      assert.strictEqual(r.missClass, "Yes, once");
      assert.deepStrictEqual(r.concern, ["Kept it to myself", "Went to the student council or an org", "Used a suggestion box or feedback form"], "keeping one concern to yourself and raising another both count");
      assert.deepStrictEqual(r.whyQuiet, ["I worried about the consequences"]);
      assert.deepStrictEqual(r.concernHeard, ["Yes, and it was fixed", "No, I never heard back"]);
      assert.deepStrictEqual(r.askFirst, ["A group chat", "A teacher or adviser"]);
      assert.deepStrictEqual(r.answerRight, ["They were right", "I couldn't tell"]);
      assert.deepStrictEqual(r.oldAnswer, ["Yes, quickly"]);
      assert.deepStrictEqual(r.guideSteps, ["I couldn't find a guide, so I figured it out"]);
      assert.deepStrictEqual(r.seniorFind, ["It hasn't happened"]);
      assert.deepStrictEqual(r.fbPosting, ["Yes, under a nickname", "Yes, anonymously"]);
      assert.deepStrictEqual(r.getAround, dorm ? ["A bicycle"] : ["I ride along with family, a relative, or a friend"]);
      assert.deepStrictEqual(r.commute, dorm ? [] : ["Multicab", "Walk"]);
      assert.strictEqual(r.whereFound, dorm ? "Applied for a VSU dorm" : null);
      assert.strictEqual(r.housingSince, dorm ? "No" : null);
      assert.deepStrictEqual(r.cantGoOut, ["Ask a friend or classmate to buy it"]);
      assert.deepStrictEqual(r.buySell, ["Facebook groups or Marketplace"]);
      assert.strictEqual(r.scamSince, "Nearly");
      assert.deepStrictEqual(r.worksWell, ["Everyone is already there", "Works with my load promo"]);
      assert.deepStrictEqual(r.wouldUse, ["Notices and deadlines in one place", "Questions about my subjects"]);
      assert.deepStrictEqual(r.whoJoin, ["Faculty", "Alumni"]);
      assert.strictEqual(r.postPreference, "Under a made-up name other members can't link to me");
      assert.strictEqual(r.wantBack, "A fix, or a reason it can't be fixed");
      assert.strictEqual(r.whoRuns, "Students, with VSU's support");
      assert.strictEqual(r.hostedPay, "Pay a small fee to use it on campus");
      assert.deepStrictEqual(r.keepAway, ["Uses too much mobile data"]);
      assert.strictEqual(r.comment, "Will the results be shared with students?");
      for (const k of ["board", "lunch", "story", "mayQuote", "trust", "postedAnonymously", "channelOrder", "mainSource", "sources", "online", "dataRunsOut", "pins"]) assert.ok(!(k in r), k + " is gone");
      assert.deepStrictEqual(r.networks, ["Smart", "DITO"]);
      assert.deepStrictEqual(r.twoSims, ["To switch when one has weak signal", "I pick each network's promo by need, like exam week"]);
      assert.deepStrictEqual(r.dataUse, ["Facebook and Messenger", "TikTok", "Google Classroom", "AI apps, like ChatGPT or Gemini", "Browsing websites and searching"]);
      for (const k of ["load", "loadApps", "validity", "department"]) assert.ok(!(k in r), k + " is gone");
      assert.strictEqual(r.untilExpiry, "No, it runs out early");
      assert.strictEqual(r.reload, "Yes, right away");
      assert.deepStrictEqual(r.reloadWhy, ["My open-access data ran out, but my app-only data didn't"], "which data ran out is one answer, never two");
      assert.strictEqual(r.dataSpend, "₱99 or ₱100");
      assert.strictEqual(r.dataSchool, "About half");
      assert.strictEqual(r.signal, "On campus only");
      assert.deepStrictEqual(r.onlineCampus, ["Mobile data", "Campus Wi-Fi"]);
      assert.deepStrictEqual(r.onlineHome, ["Wi-Fi where I reside"]);
      assert.strictEqual(r.wifiSpend, "₱200 to ₱499");
      assert.deepStrictEqual(r.firstDocuments, ["Official VSU pages or website"]);
      assert.deepStrictEqual(r.firstEvents, ["Unofficial groups, like freedom walls"]);
      assert.deepStrictEqual(r.firstScholarships, ["Usually too late"]);
      assert.deepStrictEqual(r.firstAnnouncements, ["Student council or org pages"]);
      const row = rowOf(r);
      for (const k of ["rid", "stage", "more", "transport", "transferee", "firstGen"]) assert.ok(!(k in row), "no " + k + " column");
      assert.ok(!Object.keys(row).some(k => /Cost: /.test(k)), "no what-it-cost columns");
      assert.strictEqual(row.dormPart, dorm ? "Upper campus" : "");
      assert.strictEqual(row.program, "BS Mechanical Engineering");
      assert.strictEqual(row["orgKinds: Sports"], true);
      assert.strictEqual(row["orgRun: Passing things on to the next officers"], dorm);
      assert.strictEqual(row["orgWhy: Its activities don't interest me"], !dorm);
      assert.strictEqual(row["support: I work while studying"], !dorm);
      assert.strictEqual(row["support: A scholarship or financial aid"], dorm);
      assert.strictEqual(row.barangay, dorm ? "" : "Guadalupe (Utod)");
      assert.strictEqual(row.familyVSU, dorm ? "Yes, a brother or sister" : "No, I'm the first in my family to study at VSU");
      assert.strictEqual(row["coins: online"], 4);
      assert.strictEqual(row["coins: services"], "");
      assert.strictEqual(row["classNews: Only after the class time"], true);
      assert.strictEqual(row["classNews: On the way, or when I got to the room"], false);
      assert.strictEqual(row["officialTell: I couldn't tell"], true);
      assert.strictEqual(row["missedLate: A scholarship or financial aid"], true);
      assert.strictEqual(row["checkPost: Asked a friend or classmate"], true);
      assert.strictEqual(row["scenario: Walked over and asked around"], true);
      assert.strictEqual(row["whichOffice: Cashier or accounting"], true);
      assert.strictEqual(row["visitsTook: Four or more"], true);
      assert.strictEqual(row["reachWhy: A signature or a document"], true);
      assert.strictEqual(row["reachHard: I hesitated to ask"], true);
      assert.strictEqual(row.missClass, "Yes, once");
      assert.strictEqual(row["concern: Kept it to myself"], true);
      assert.strictEqual(row["concern: Used a suggestion box or feedback form"], true);
      assert.strictEqual(row["concern: unlisted"], "");
      assert.strictEqual(row["concernHeard: No, I never heard back"], true);
      assert.strictEqual(row["askFirst: A teacher or adviser"], true);
      assert.strictEqual(row["answerRight: I couldn't tell"], true);
      assert.strictEqual(row["oldAnswer: Yes, quickly"], true);
      assert.strictEqual(row["guideSteps: I couldn't find a guide, so I figured it out"], true);
      assert.strictEqual(row["seniorFind: It hasn't happened"], true);
      assert.strictEqual(row["fbPosting: Yes, anonymously"], true);
      assert.strictEqual(row[dorm ? "getAround: A bicycle" : "getAround: I ride along with family, a relative, or a friend"], true);
      assert.strictEqual(row["commute: Walk"], !dorm);
      assert.strictEqual(row["whoJoin: Alumni"], true);
      assert.strictEqual(row.whoRuns, "Students, with VSU's support");
      assert.strictEqual(row.faculty, "Faculty of Engineering");
      assert.strictEqual(row["worksWell: Works with my load promo"], true);
      assert.strictEqual(row["wouldUse: Questions about my subjects"], true);
      assert.strictEqual(row["away: unlisted"], "");
      assert.strictEqual(row.groupChats, "6 to 10");
      assert.strictEqual(row["officialHow: Someone shares them with me"], true);
      assert.strictEqual(row.wantBack, "A fix, or a reason it can't be fixed");
      assert.ok(!Object.keys(row).some(k => / often$| matters$|^pin\d|^lunch$/.test(k)), "no scene, pin, or lunch columns");
      assert.strictEqual(row["network: DITO"], true);
      assert.strictEqual(row["dataUse: Google Classroom"], true);
      assert.strictEqual(row["dataUse: YouTube"], false);
      assert.strictEqual(row["reloadWhy: My open-access data ran out, but my app-only data didn't"], true);
      assert.strictEqual(row["wifiSpend (month)"], "₱200 to ₱499");
      assert.strictEqual(row["dataSpend (week)"], "₱99 or ₱100");
      assert.strictEqual(row.hostedPay, "Pay a small fee to use it on campus");
      assert.strictEqual(row["firstScholarships 1"], "Usually too late");
      assert.strictEqual(row["firstSuspensions 2"], "Official VSU pages or website");
      assert.strictEqual(row["firstSuspensions 3"], "");
      assert.strictEqual(row["buySell: Facebook groups or Marketplace"], true);
      assert.strictEqual(row.scamSince, "Nearly");
      assert.strictEqual(row["onCampus: Campus Wi-Fi"], true);
      assert.strictEqual(row["whereStaying: Wi-Fi where I reside"], true);
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
      return { missed: get("missedLate", "missedLate"), classNews: get("classNews", "classNews"), officialTell: get("officialTell", "officialTell"), scenario: get("scenario", "scenario"), office: get("whichOffice", "whichOffice"), visits: get("visitsTook", "visitsTook"), reachWhy: get("reachWhy", "reachWhy"), reachHard: get("reachHard", "reachHard"), askFirst: get("askFirst", "askFirst"), answerRight: get("answerRight", "answerRight"), oldAnswer: get("oldAnswer", "oldAnswer"), guideSteps: get("guideSteps", "guideSteps"), seniorFind: get("seniorFind", "seniorFind"), getAround: get("getAround", "getAround"), commute: get("commute", "commute"), orgWhy: get("orgWhy", "orgWhy"), orgKinds: get("orgKinds", "orgKinds"), orgRun: get("orgRun", "orgRun"), orgKeep: get("orgKeep", "orgKeep"), orgNone: get("orgNone", "orgNone"), support: get("support", "support"), join: get("whoJoin", "whoJoin"), heard: get("concernHeard", "concernHeard"), fb: get("fbPosting", "fbPosting"), cant: get("cantGoOut", "cantGoOut"), buy: get("buySell", "buySell"), officialHow: get("officialHow", "officialHow"), checkPost: get("checkPost", "checkPost"), whyQuiet: get("whyQuiet", "whyQuiet"), reloadWhy: get("reloadWhy", "reloadWhy"), twoSims: get("twoSims", "twoSims"), networks: get("networks", "networks"), oc: get("onlineCampus", "onlineCampus"), oh: get("onlineHome", "onlineHome"), dataUse: get("dataUse", "dataUse"), concern: get("concern", "concern"), works: get("worksWell", "worksWell"), pull: get("wouldUse", "wouldUse"), away: get("keepAway", "keepAway") };
    });
    assert.deepStrictEqual(vals.concern.slice().sort(), receiver.CONCERN.slice().sort());
    assert.deepStrictEqual(vals.heard.slice().sort(), receiver.HEARD.slice().sort());
    for (const [k, list] of [["classNews", "CLASS_NEWS"], ["officialTell", "OFFICIAL_TELL"], ["scenario", "SCENARIO"], ["office", "OFFICE"], ["visits", "VISITS"], ["reachWhy", "REACH_WHY"], ["reachHard", "REACH_HARD"],
      ["askFirst", "ASK_FIRST"], ["answerRight", "ANSWER_RIGHT"], ["oldAnswer", "OLD_ANSWER"], ["guideSteps", "GUIDE_STEPS"], ["seniorFind", "SENIOR_FIND"], ["getAround", "GET_AROUND"], ["commute", "COMMUTE"], ["orgWhy", "ORG_WHY"], ["orgKinds", "ORG_KINDS"], ["orgRun", "ORG_RUN"], ["orgKeep", "ORG_KEEP"], ["orgNone", "ORG_NONE"], ["support", "SUPPORT"]])
      assert.deepStrictEqual(vals[k].slice().sort(), receiver[list].slice().sort(), k + " matches the receiver's " + list);
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
    assert.deepStrictEqual(vals.dataUse.slice().sort(), receiver.DATA_USE.slice().sort());
    assert.deepStrictEqual(vals.pull.slice().sort(), receiver.WOULD_USE.slice().sort());
    assert.deepStrictEqual(vals.away.slice().sort(), receiver.AWAY.slice().sort());
    assert.deepStrictEqual(vals.missed.slice().sort(), receiver.MISSED_LATE.slice().sort());
    await t.ctx.close();
  });

  await check("skipping the networks skips every question on load and data, and why two SIMs comes only with two", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "year");
    const steps = () => t.page.evaluate(() => window.__survey.steps());
    await t.page.evaluate(() => window.__survey.go("networks"));
    await at(t.page, "networks");
    assert.ok(!(await steps()).includes("twoSims"), "no networks, no question on two SIMs");
    let L = await steps();
    for (const id of ["dataSpend", "dataUse", "untilExpiry", "reload", "reloadWhy", "dataSchool", "signal"]) assert.ok(!L.includes(id), id + " is skipped with no mobile data");
    await next(t.page);
    await at(t.page, "onlineCampus");
    assert.ok(await t.page.locator(btn("onlineCampus", "Mobile data")).isHidden(), "no mobile data among the ways to get online on campus");
    await t.page.click(btn("onlineCampus", "Campus Wi-Fi"));
    await t.page.click(btn("onlineCampus", "I usually don't go online while on campus"));
    assert.deepStrictEqual(await t.page.evaluate(() => window.__survey.answers.onlineCampus), ["I usually don't go online while on campus"], "not going online on campus stands alone");
    assert.strictEqual(await t.page.locator(inStep("onlineCampus", '[data-v="Campus Wi-Fi"]')).count(), 1);
    // Wi-Fi spending follows only Wi-Fi where they stay
    await t.page.evaluate(() => window.__survey.go("onlineHome"));
    await at(t.page, "onlineHome");
    assert.ok(await t.page.locator(btn("onlineHome", "Mobile data")).isHidden(), "or where they reside");
    assert.ok(!(await steps()).includes("wifiSpend"), "no Wi-Fi spending before Wi-Fi where they reside is picked");
    await t.page.click(btn("onlineHome", "Wi-Fi where I reside"));
    assert.ok((await steps()).includes("wifiSpend"));
    await next(t.page);
    await at(t.page, "wifiSpend");
    await t.page.click(btn("wifiSpend", "₱200 to ₱499"));
    await t.page.evaluate(() => window.__survey.go("onlineHome"));
    await at(t.page, "onlineHome");
    await t.page.click(btn("onlineHome", "Wi-Fi where I reside"));
    assert.strictEqual(await t.page.evaluate(() => window.__survey.answers.wifiSpend), null, "taking back Wi-Fi where they stay takes back what it costs");
    assert.ok(!(await steps()).includes("wifiSpend"));
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
    await t.page.evaluate(() => { const a = window.__survey.answers; a.dataUse.push("TikTok"); a.onlineCampus.length = 0; a.onlineCampus.push("Mobile data"); });
    await t.page.click(btn("networks", "Globe"));
    const a0 = await t.page.evaluate(() => window.__survey.answers);
    assert.deepStrictEqual([a0.dataUse, a0.onlineCampus], [[], []], "no network takes back what data is used for, and mobile data on campus");
    assert.deepStrictEqual(t.errors, []);
    await t.ctx.close();
  });

  await check("networks take at most two picks, and load in a week comes right after them", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "year");
    const ans = () => t.page.evaluate(() => window.__survey.answers);
    const steps = () => t.page.evaluate(() => window.__survey.steps());
    await t.page.evaluate(() => window.__survey.go("networks"));
    await at(t.page, "networks");
    assert.strictEqual(await t.page.locator(inStep("networks", ".kicker")).textContent(), "Mobile networks");
    for (const n of ["Smart", "TNT", "Globe", "TM", "GOMO", "DITO"]) assert.strictEqual(await t.page.locator(btn("networks", n)).count(), 1, n + " has its own button");
    await t.page.click(btn("networks", "Smart"));
    await t.page.click(btn("networks", "DITO"));
    await t.page.click(btn("networks", "Globe"));
    assert.deepStrictEqual((await ans()).networks, ["Smart", "DITO"], "a third network is refused");
    await next(t.page);
    await at(t.page, "twoSims");
    await next(t.page);
    await at(t.page, "dataSpend");
    await t.page.click(btn("dataSpend", "Someone else pays for it"));
    assert.strictEqual((await ans()).dataSpend, "Someone else pays for it", "load someone else pays for is its own answer");
    await at(t.page, "dataUse");
    await t.page.click(btn("dataUse", "YouTube"));
    await t.page.click(btn("dataUse", "Other"));
    assert.ok(await t.page.locator(inStep("dataUse", "[data-other]")).isVisible(), "Other opens a box to type in");
    await next(t.page);
    await at(t.page, "untilExpiry");
    await next(t.page);
    await at(t.page, "dataSchool");
    assert.ok(!(await steps()).includes("reload"), "skipping the data allocation (no promo) skips the promo follow-ups");
    await t.page.click(btn("dataSchool", "Almost all"));
    await at(t.page, "signal");
    await t.page.click(btn("signal", "Where I reside only"));
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
    await at(t.page, "year");
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
    assert.strictEqual(r.barangay, null, "no barangay without where you wake up");
    assert.strictEqual(r.familyVSU, null);
    assert.strictEqual(t.posts.length, 1);
    assert.ok(!("pins" in r) && !("board" in r));
    for (const k of ["groupChats", "wifiSpend", "whereFound", "housingSince", "scamSince", "whoRuns", "hostedPay"]) assert.strictEqual(r[k], null, k);
    for (const k of ["firstClasses", "firstSuspensions", "firstDocuments", "firstEvents", "firstScholarships", "firstAnnouncements", "officialHow", "classNews", "officialTell", "checkPost", "missedLate",
      "scenario", "whichOffice", "visitsTook", "reachWhy", "reachHard", "whyQuiet", "concernHeard", "askFirst", "answerRight", "oldAnswer", "guideSteps", "seniorFind", "fbPosting", "getAround", "commute", "cantGoOut", "buySell", "whoJoin"]) assert.deepStrictEqual(r[k], [], k);
    for (const k of ["year", "faculty", "org", "familyVSU", "dormPart"]) assert.strictEqual(r[k], null, k + " can be skipped");
    assert.deepStrictEqual([r.support, r.orgWhy, r.orgKinds], [[], [], []]);
    assert.strictEqual(r.program, null);
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

  await check("the survey's own address, /student-life, counts as live", async () => {
    const t = await open(browser, { host: PROD, query: "student-life" });
    assert.strictEqual(await t.page.evaluate(() => window.__survey.live), true);
    await t.ctx.close();
  });

  await check("the old .vercel.app addresses no longer count as live", async () => {
    for (const host of [VERCEL_PROD, OLD_PROD]) {
      const t = await open(browser, { host });
      assert.strictEqual(await t.page.evaluate(() => window.__survey.live), false, host);
      await t.ctx.close();
    }
  });

  await check("a preview address sends nothing and shows the record instead", async () => {
    const t = await open(browser, { host: PREVIEW });
    assert.strictEqual(await t.page.evaluate(() => window.__survey.live), false);
    assert.ok((await t.page.locator("#flag").textContent()).indexOf("Preview") === 0);
    assert.strictEqual(await t.page.locator("#h-intro").textContent(), "VSUrvey");
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "year");
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
    await at(t.page, "year");
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
    await at(t.page, "year");
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
    await at(t.page, "year");
    await t.page.keyboard.press("ArrowRight");
    await at(t.page, "faculty");
    await t.page.keyboard.press("ArrowLeft");
    await at(t.page, "year");
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
      await at(t.page, "year");
      for (const [id, home, org, fac] of [["year"], ["faculty"], ["program", null, null, "Faculty of Teacher Education"], ["home"], ["dormPart", "An on-campus dorm"], ["barangay", "A boarding house or apartment near campus"], ["org"],
        ["orgKinds", null, "An officer or leader"], ["orgRun"], ["orgKeep", null, "An active member"], ["orgWhy", null, "A member, but I rarely take part"], ["orgNone", null, "Not a member of any"], ["support"], ["familyVSU"]]) {
        if (org) await t.page.evaluate(x => { window.__survey.answers.org = x; }, org);
        if (fac) await t.page.evaluate(x => { window.__survey.answers.faculty = x; }, fac);
        if (home) await t.page.evaluate(x => { window.__survey.answers.residence = x; }, home);
        await t.page.evaluate(x => window.__survey.go(x), id);
        await at(t.page, id);
        const hidden = await t.page.evaluate(({ id, mobile }) => {
          const p = document.querySelector('[data-step="' + id + '"]'), pr = p.getBoundingClientRect();
          const n = document.getElementById("next").getBoundingClientRect();
          const bottom = mobile ? Math.min(innerHeight - 84, n.top) : Math.min(pr.bottom, innerHeight);
          if (mobile) return window.phoneFit(p, bottom);
          return Array.from(p.querySelectorAll("[data-v]")).filter(e => e.offsetParent !== null).filter(e => { const b = e.getBoundingClientRect(); return b.bottom > bottom + 1 || b.top < pr.top - 1; }).map(e => e.dataset.v);
        }, { id, mobile });
        assert.deepStrictEqual(hidden, [], id + ": " + (mobile ? "drawing or reach" : "answers below the fold"));
      }
      await t.ctx.close();
    });
  }

  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 664 }, { width: 412, height: 720 }, { width: 390, height: 844 }, { width: 1366, height: 768 }]) {
    await check("from Getting online to Send, " + (vp.width < 700 ? "the drawing stays in view and every answer can be scrolled to" : "every answer is in view without scrolling") + " at " + vp.width + "x" + vp.height, async () => {
      const mobile = vp.width < 700;
      const t = await open(browser, { viewport: vp, mobile, reduced: true });
      await t.page.click("#start");
      await at(t.page, "consent");
      await t.page.click(inStep("consent", ".agree"));
      await next(t.page);  // with reduced motion nothing moves on by itself
      await at(t.page, "year");
      const fold = ({ id, mobile }) => {
        const p = document.querySelector('[data-step="' + id + '"]'), pr = p.getBoundingClientRect();
        const n = document.getElementById("next"), nr = n.getBoundingClientRect();
        const bottom = mobile ? Math.min(innerHeight - 84, n.hidden ? innerHeight : nr.top) : Math.min(pr.bottom, innerHeight);
        if (mobile) return window.phoneFit(p, bottom);
        return Array.from(p.querySelectorAll("[data-v], textarea, #send")).filter(e => e.offsetParent !== null && true).filter(e => { const b = e.getBoundingClientRect(); return b.bottom > bottom + 1 || b.top < pr.top - 1; }).map(e => e.dataset.v || e.id);
      };
      // Answers that bring every follow-up, so each screen is checked
      await t.page.evaluate(() => { const a = window.__survey.answers; a.networks = ["Smart", "DITO"]; a.untilExpiry = "No, it runs out early"; a.reload = "Yes, right away";
        a.residence = "A boarding house or apartment near campus"; a.scenario = ["Walked over and asked around"]; a.reachWhy = ["A grade or a requirement"]; a.concern = ["Kept it to myself", "Told the office directly"];
        a.firstClasses = ["Unofficial groups, like freedom walls", "Group chats: class, org, friends", "Campus bulletin boards"];
        a.officialTell = ["I couldn't tell"]; a.missedLate = ["An OJT host"]; a.askFirst = ["An unofficial student group or freedom wall"]; });
      const ids = (await t.page.evaluate(() => window.__survey.steps())).filter(x => ["intro", "consent", "home", "dormPart", "barangay", "year", "faculty", "program", "org", "orgKinds", "orgRun", "orgKeep", "orgWhy", "orgNone", "support", "familyVSU", "final"].indexOf(x) < 0);
      for (const k of ["checkPost", "whichOffice", "visitsTook", "reachHard", "whyQuiet", "concernHeard", "answerRight", "commute", "whereFound", "housingSince", "scamSince", "hostedPay"]) assert.ok(ids.includes(k), "every follow-up is checked: " + k);
      for (const id of ids) {
        await t.page.evaluate(x => window.__survey.go(x), id);
        await at(t.page, id);
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
    assert.ok((await t.page.locator(inStep("consent", ".agree")).textContent()).includes("current VSU Main Campus undergraduate student"), "undergraduates only");
    await t.page.click("#next", { force: true });
    assert.strictEqual(await current(t.page), "consent", "Next does not pass the gate before the box is ticked");
    await t.page.click(inStep("consent", ".agree"));
    assert.strictEqual(await t.page.locator("#gate-say span").textContent(), "Come in!");
    assert.strictEqual(await t.page.locator(".scene.gate-open").count(), 1, "the gate opens");
    await at(t.page, "year");
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
    /* The scene's idle motion (blinks, clouds, the sun) is paused, so what changes between two pointer positions is what
       follows the pointer. */
    const snap = () => t.page.evaluate(() => {
      document.getAnimations().forEach(a => a.pause());
      const out = {};
      document.querySelectorAll('[data-box="gate"] svg *').forEach((el, i) => {
        if (el.closest(".arm, .say, .wave, .bubble")) return;
        out[i] = { tr: getComputedStyle(el).transform, pupil: el.classList.contains("pupil"), name: el.tagName + "." + el.getAttribute("class") };
      });
      return out;
    });
    await t.page.mouse.move(5, 5);
    await t.page.waitForTimeout(700);
    const a = await snap();
    await t.page.evaluate(() => document.getAnimations().forEach(x => x.play()));
    await t.page.mouse.move(1300, 700, { steps: 8 });
    await t.page.waitForTimeout(700);
    const b = await snap();
    const moved = Object.keys(b).filter(k => a[k] && a[k].tr !== b[k].tr);
    assert.ok(moved.filter(k => b[k].pupil).length >= 2, "the guard's eyes follow the pointer");
    assert.deepStrictEqual(moved.filter(k => !b[k].pupil).map(k => b[k].name), [], "nothing else in the scene moves with the pointer");
    await t.ctx.close();
  });

  /* three.js draws two moments, the ring of coins on the first screen and the confetti on the last, only on a computer or a
     fast connection without data saver, with motion on and a graphics card (D-166). It loads after the first screen shows. */
  await check("a computer gets the 3D ring of coins on the first screen and the confetti on the last", async () => {
    const t = await open(browser, { init: [SOFT_GL, 'window.__drawn = 0; (function look() { var h = document.querySelector(\'[data-box="intro"] .hero\'); if (h && getComputedStyle(h).opacity !== "0") window.__drawn++; if (!document.querySelector("canvas.three.on")) requestAnimationFrame(look); })();'] });
    await t.page.waitForSelector('[data-box="intro"] .stage.has-3d > canvas.three.on', { timeout: 15000 });
    assert.strictEqual(await t.page.evaluate(() => window.__drawn), 0, "the drawn ring never shows before the coins");
    assert.deepStrictEqual(from3d(t).sort(), ["js/scene3d.js", "js/three.module.min.js"]);
    await t.page.waitForFunction(() => getComputedStyle(document.querySelector('[data-box="intro"] .hero')).opacity === "0", null, { timeout: 3000 });
    assert.strictEqual(await t.page.locator('[data-box="intro"] canvas').evaluate(c => getComputedStyle(c).pointerEvents), "none", "the drawing takes no taps");
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.waitForFunction(() => !document.querySelector("canvas"), null, { timeout: 5000 });
    assert.ok(!(await t.page.locator('[data-box="intro"] .stage').evaluate(s => s.classList.contains("has-3d"))), "the ring gives the drawn one back when it stops");
    await t.page.click("#prev");
    await at(t.page, "intro");
    await t.page.waitForSelector('[data-box="intro"] canvas.three.on', { timeout: 5000 });
    assert.strictEqual(await t.page.locator("canvas").count(), 1, "the ring starts again, once, on the way back");
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "year");
    await t.page.evaluate(() => window.__survey.go("send"));
    await at(t.page, "send");
    await sendIt(t.page);
    await at(t.page, "final");
    await t.page.waitForSelector('[data-box="final"] .stage > canvas.three.on', { timeout: 5000 });
    await t.page.waitForFunction(() => !document.querySelector("canvas"), null, { timeout: 12000 });
    assert.deepStrictEqual(from3d(t).sort(), ["js/scene3d.js", "js/three.module.min.js"], "loaded once");
    assert.deepStrictEqual(t.errors, []);
    assert.deepStrictEqual(await t.page.evaluate(() => window.__csp), [], "the security policy blocks nothing");
    await t.ctx.close();
  });

  await check("reduced motion, data saver, a slow phone, no graphics card, or a short screen load no 3D at first", async () => {
    for (const [why, o] of [
      ["reduced motion", { reduced: true, init: SOFT_GL }],
      ["data saver", { init: [SOFT_GL, NET({ saveData: true, effectiveType: "4g" })] }],
      ["a phone on 3G", { mobile: true, init: [SOFT_GL, NET({ saveData: false, effectiveType: "3g" })] }],
      ["a phone that doesn't report its connection", { mobile: true, init: [SOFT_GL, NET(null)] }],
      ["no graphics card", { init: NO_GL }],
      ["a short phone screen, even on a fast connection", { mobile: true, init: [SOFT_GL, NET({ saveData: false, effectiveType: "4g" })] }]
    ]) {
      const t = await open(browser, o);
      await t.page.waitForTimeout(1500);
      assert.deepStrictEqual(from3d(t), [], why + ": nothing is fetched from js/");
      assert.strictEqual(await t.page.locator("canvas").count(), 0, why + ": no 3D drawing");
      assert.ok(await t.page.locator('[data-box="intro"] .hero .t').first().isVisible(), why + ": the drawn ring stays");
      assert.deepStrictEqual(t.errors, [], why);
      await t.ctx.close();
    }
    const t = await open(browser, { mobile: true, viewport: { width: 390, height: 844 }, init: [SOFT_GL, NET({ saveData: false, effectiveType: "4g" })] });
    await t.page.waitForSelector('[data-box="intro"] canvas.three.on', { timeout: 15000 });
    assert.deepStrictEqual(t.errors, [], "a phone on a fast connection, with room around the title, gets the ring");
    await t.ctx.close();
    /* A short screen on a fast connection still gets the confetti: three.js loads at the end. */
    const u = await open(browser, { mobile: true, init: [SOFT_GL, NET({ saveData: false, effectiveType: "4g" })] });
    await u.page.click("#start");
    await at(u.page, "consent");
    await u.page.click(inStep("consent", ".agree"));
    await at(u.page, "year");
    await u.page.evaluate(() => window.__survey.go("send"));
    await at(u.page, "send");
    assert.deepStrictEqual(from3d(u), [], "nothing is fetched from js/ before the end");
    await sendIt(u.page);
    await at(u.page, "final");
    await u.page.waitForSelector('[data-box="final"] .stage > canvas.three.on', { timeout: 8000 });
    assert.deepStrictEqual(u.errors, []);
    await u.ctx.close();
  });

  await check("the Your form scene never fades while she types an answer", async () => {
    const t = await open(browser, {});
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "year");
    await t.page.click(btn("year", "2nd"));
    const seen = [];
    for (let i = 0; i < 12; i++) {
      seen.push(await t.page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-box="pass"] .scene')).opacity)));
      await t.page.waitForTimeout(100);
    }
    assert.ok(seen.every(o => o === 1), "the drawing's opacity: " + seen.join(", "));
    await t.ctx.close();
  });

  await check("the walk works with reduced motion", async () => {
    const t = await open(browser, { reduced: true, mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await next(t.page);  // with reduced motion nothing moves on by itself
    await at(t.page, "year");
    assert.ok((await t.page.locator(".how span").textContent()).indexOf("then Next") > 0, "the intro says to tap Next");
    await t.page.click(btn("year", "1st"));
    await t.page.waitForTimeout(1300);
    assert.strictEqual(await current(t.page), "year", "with reduced motion, an answer doesn't move the page on by itself");
    await next(t.page);
    await at(t.page, "faculty");
    await t.page.evaluate(() => window.__survey.go("familyVSU"));
    await at(t.page, "familyVSU");
    await t.page.click(btn("familyVSU", "Not sure"));
    await next(t.page);
    await at(t.page, "networks");
    assert.deepStrictEqual(t.errors, []);
    await t.ctx.close();
  });

  await check("the parts are in the menu in one walk, and the follow-ups behave", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "year");
    const steps = () => t.page.evaluate(() => window.__survey.steps());
    const ans = () => t.page.evaluate(() => window.__survey.answers);
    const menuParts = async () => { await t.page.click("#chap"); const p = await t.page.locator(".menu-list .mname").evaluateAll(ls => ls.map(l => l.firstChild.textContent)); await t.page.keyboard.press("Escape"); return p; };
    const parts = await menuParts();
    assert.deepStrictEqual(parts, ["Your form", "Getting online", "Hearing from campus", "Reaching out", "Students and alumni", "Daily life", "Coins", "Network idea", "Send"], "one walk in v2's order, with the mornings in Your form");
    assert.strictEqual(await t.page.locator("#dots i").count(), 10, "a dot for every part");
    assert.ok(/^\d+% answered$/.test(await (async () => { await t.page.click("#chap"); const x = await t.page.locator("#menu-total").textContent(); await t.page.keyboard.press("Escape"); return x; })()), "the menu shows how much is answered");
    const L0 = await steps();
    assert.ok(L0.indexOf("coins") > L0.indexOf("scamSince") && L0.indexOf("coins") < L0.indexOf("worksWell"), "the coins come after Daily life, before the network idea");
    assert.ok(L0.indexOf("hostedPay") > L0.indexOf("whoRuns") && L0.indexOf("hostedPay") < L0.indexOf("keepAway"), "hosting on campus stays with the network idea");
    // Program follows faculty, offering only that faculty's; a faculty with one program records it without asking (owner, 23 October 2026)
    await t.page.evaluate(() => window.__survey.go("faculty"));
    await at(t.page, "faculty");
    await t.page.click(btn("faculty", "Faculty of Humanities and Social Sciences"));
    await at(t.page, "program");
    assert.deepStrictEqual(await t.page.locator(inStep("program", "[data-v]")).evaluateAll(bs => bs.filter(b => !b.hidden).map(b => b.dataset.v)), ["BA English Language Studies", "BA Literature", "BA Philosophy"]);
    await t.page.click(btn("program", "BA Philosophy"));
    await t.page.evaluate(() => window.__survey.go("faculty"));
    await at(t.page, "faculty");
    await t.page.click(btn("faculty", "Faculty of Nursing"));
    assert.strictEqual((await ans()).program, "BS Nursing", "a faculty's only program is recorded without asking");
    assert.ok(!(await steps()).includes("program"), "no program question for a faculty with one");
    assert.strictEqual(await t.page.locator('#passcard [data-f="program"]').textContent(), "BS Nursing");
    await t.page.evaluate(() => window.__survey.go("faculty"));
    await at(t.page, "faculty");
    await t.page.click(btn("faculty", "Faculty of Engineering"));
    assert.strictEqual((await ans()).program, null, "a program of another faculty is taken back");
    await at(t.page, "program");
    assert.strictEqual(await t.page.locator(btn("program", "Another program")).count(), 0, "no Another program");
    await t.page.evaluate(() => window.__survey.go("faculty"));
    await at(t.page, "faculty");
    await t.page.click(btn("faculty", "Faculty of Natural and Mathematical Sciences"));
    await at(t.page, "program");
    assert.deepStrictEqual(await t.page.locator(inStep("program", "[data-v]")).evaluateAll(bs => bs.filter(b => !b.hidden).map(b => b.dataset.v)), ["BS Agricultural Chemistry", "BS Applied Physics", "BS Biology", "BS Biotechnology", "BS Chemistry", "BS Mathematics", "BS Meteorology", "BS Statistics"]);
    // One org follow-up for each level of involvement, and kinds of orgs for members only
    await t.page.evaluate(() => window.__survey.go("org"));
    await at(t.page, "org");
    await t.page.click(btn("org", "An active member"));
    await at(t.page, "orgKinds");
    await t.page.click(btn("orgKinds", "Religious"));
    await next(t.page);
    await at(t.page, "orgKeep");
    await t.page.click(btn("orgKeep", "My friends are in it"));
    await t.page.evaluate(() => window.__survey.go("org"));
    await at(t.page, "org");
    await t.page.click(btn("org", "Not a member of any"));
    let o = await ans();
    assert.deepStrictEqual([o.orgKinds, o.orgKeep], [[], []], "leaving orgs takes back the kinds and what kept them active");
    assert.ok(!(await steps()).includes("orgKinds"), "no kinds of orgs for a non-member");
    await at(t.page, "orgNone");
    assert.strictEqual(await t.page.locator(inStep("orgNone", "h2")).textContent(), "Why aren't you in any org?");
    // Where on campus, or which barangay, follows where you live; getting to campus follows living off campus (owner, 23 October 2026)
    await t.page.evaluate(() => window.__survey.go("home"));
    await at(t.page, "home");
    await t.page.click(btn("home", "A boarding house or apartment near campus"));
    await at(t.page, "barangay");
    await t.page.click(btn("barangay", "Pangasugan"));
    await at(t.page, "org");
    await t.page.evaluate(() => { window.__survey.answers.commute.push("Multicab"); window.__survey.go("home"); });
    await at(t.page, "home");
    await t.page.click(btn("home", "An on-campus dorm"));
    let a = await ans();
    assert.deepStrictEqual([a.barangay, a.commute], [null, []], "moving to a dorm takes back the barangay and the way to campus");
    assert.ok(!(await steps()).includes("barangay") && !(await steps()).includes("commute"));
    await at(t.page, "dormPart");
    await t.page.click(btn("dormPart", "Lower campus"));
    await t.page.evaluate(() => window.__survey.go("home"));
    await at(t.page, "home");
    await t.page.click(btn("home", "My family's home, and I commute"));
    assert.strictEqual((await ans()).dormPart, null, "leaving the dorm takes back the part of campus");
    assert.ok((await steps()).includes("commute"), "a commuter is asked how they get to campus");
    // Getting to campus offers one's own vehicle, or a ride, only to those who have one
    const shown = id => t.page.locator(inStep(id, "[data-v]")).evaluateAll(bs => bs.filter(b => !b.hidden).map(b => b.dataset.v));
    await t.page.evaluate(() => window.__survey.go("getAround"));
    await at(t.page, "getAround");
    await t.page.click(btn("getAround", "A motorcycle"));
    await t.page.click(btn("getAround", "None of these"));
    assert.deepStrictEqual((await ans()).getAround, ["None of these"], "None of these stands alone");
    await next(t.page);
    await at(t.page, "commute");
    let opts = await shown("commute");
    assert.ok(!opts.includes("My own bicycle, motorcycle, or car") && !opts.includes("A ride with family, a relative, or a friend") && opts.includes("Walk"), "no vehicle and no ride: " + opts);
    await t.page.evaluate(() => window.__survey.go("getAround"));
    await at(t.page, "getAround");
    await t.page.click(btn("getAround", "A motorcycle"));
    await next(t.page);
    await at(t.page, "commute");
    await t.page.click(btn("commute", "My own bicycle, motorcycle, or car"));
    await t.page.evaluate(() => window.__survey.go("getAround"));
    await at(t.page, "getAround");
    await t.page.click(btn("getAround", "A motorcycle"));
    await t.page.click(btn("getAround", "I ride along with family, a relative, or a friend"));
    assert.deepStrictEqual((await ans()).commute, [], "giving up the motorcycle takes back riding it to campus");
    // What made it hard follows a reason to reach someone; "It hasn't happened" stands alone and clears it
    assert.ok(!(await steps()).includes("reachHard"), "what made it hard waits for a reason");
    await t.page.evaluate(() => window.__survey.go("reachWhy"));
    await at(t.page, "reachWhy");
    await t.page.click(btn("reachWhy", "A grade or a requirement"));
    await t.page.click(btn("reachWhy", "A deadline or a schedule"));
    await next(t.page);
    await at(t.page, "reachHard");
    await t.page.click(btn("reachHard", "I didn't know how to contact them"));
    await t.page.click(btn("reachHard", "It hasn't been hard"));
    assert.deepStrictEqual((await ans()).reachHard, ["It hasn't been hard"], "It hasn't been hard stands alone");
    await t.page.click(btn("reachHard", "I hesitated to ask"));
    await t.page.evaluate(() => window.__survey.go("reachWhy"));
    await at(t.page, "reachWhy");
    await t.page.click(btn("reachWhy", "It hasn't happened"));
    a = await ans();
    assert.deepStrictEqual([a.reachWhy, a.reachHard], [["It hasn't happened"], []], "It hasn't happened stands alone and clears the follow-up");
    assert.ok(!(await steps()).includes("reachHard"));
    // A concern: keeping one to yourself and raising another both count
    await t.page.evaluate(() => window.__survey.go("concern"));
    await at(t.page, "concern");
    await t.page.click(btn("concern", "Told the office directly"));
    await t.page.click(btn("concern", "It hasn't happened"));
    assert.deepStrictEqual((await ans()).concern, ["It hasn't happened"], "It hasn't happened stands alone");
    await t.page.click(btn("concern", "Kept it to myself"));
    await t.page.click(btn("concern", "Posted about it online"));
    assert.deepStrictEqual((await ans()).concern, ["Kept it to myself", "Posted about it online"], "since starting at VSU, both can be true");
    assert.ok((await steps()).includes("whyQuiet") && (await steps()).includes("concernHeard"), "so both follow-ups are asked");
    await t.page.evaluate(() => window.__survey.go("whyQuiet"));
    await at(t.page, "whyQuiet");
    await t.page.click(btn("whyQuiet", "I worried about the consequences"));
    await t.page.evaluate(() => window.__survey.go("concernHeard"));
    await at(t.page, "concernHeard");
    assert.strictEqual(await t.page.locator(inStep("concernHeard", "h2")).textContent(), "Did you learn what happened to the concerns you raised?", "the question names what it follows");
    await t.page.click(btn("concernHeard", "It's still being looked into"));
    await t.page.evaluate(() => window.__survey.go("concern"));
    await at(t.page, "concern");
    await t.page.click(btn("concern", "Posted about it online"));
    a = await ans();
    assert.deepStrictEqual([a.concern, a.concernHeard], [["Kept it to myself"], []], "with nothing raised, hearing back is taken back");
    await t.page.click(btn("concern", "Kept it to myself"));
    assert.deepStrictEqual((await ans()).whyQuiet, [], "and with nothing kept, why it was kept");
    // Checking a post follows a post that couldn't be placed
    await t.page.evaluate(() => window.__survey.go("officialTell"));
    await at(t.page, "officialTell");
    assert.ok(!(await steps()).includes("checkPost"));
    await t.page.click(btn("officialTell", "Yes, right away"));
    assert.ok(!(await steps()).includes("checkPost"), "telling right away brings no checking");
    await t.page.click(btn("officialTell", "Not at first, so I checked"));
    assert.ok((await steps()).includes("checkPost"), "a post that couldn't be placed brings how it was checked");
    await t.page.click(btn("officialTell", "I haven't seen one"));
    assert.deepStrictEqual((await ans()).officialTell, ["I haven't seen one"], "I haven't seen one stands alone");
    assert.ok(!(await steps()).includes("checkPost"));
    // Class changes: It hasn't happened stands alone
    await t.page.evaluate(() => window.__survey.go("classNews"));
    await at(t.page, "classNews");
    await t.page.click(btn("classNews", "Only after the class time"));
    await t.page.click(btn("classNews", "Before the class time"));
    assert.deepStrictEqual((await ans()).classNews, ["Only after the class time", "Before the class time"], "early and late both count");
    await t.page.click(btn("classNews", "It hasn't happened"));
    assert.deepStrictEqual((await ans()).classNews, ["It hasn't happened"]);
    assert.strictEqual(await current(t.page), "classNews", "picking all that happened doesn't move on by itself");
    // Missed for hearing too late: None of these stands alone
    await t.page.evaluate(() => window.__survey.go("missedLate"));
    await at(t.page, "missedLate");
    await t.page.click(btn("missedLate", "An event I wanted to join"));
    await t.page.click(btn("missedLate", "None of these"));
    assert.deepStrictEqual((await ans()).missedLate, ["None of these"], "None of these stands alone");
    // Whether answers were right follows asking other students
    await t.page.evaluate(() => window.__survey.go("askFirst"));
    await at(t.page, "askFirst");
    await t.page.click(btn("askFirst", "A teacher or adviser"));
    assert.ok(!(await steps()).includes("answerRight"), "asking a teacher brings no question about other students' answers");
    await t.page.click(btn("askFirst", "A classmate or senior, in person"));
    assert.ok((await steps()).includes("answerRight"), "asking a classmate too brings whether the answers were right");
    await t.page.evaluate(() => window.__survey.go("answerRight"));
    await at(t.page, "answerRight");
    await t.page.click(btn("answerRight", "Some were wrong"));
    await t.page.evaluate(() => window.__survey.go("askFirst"));
    await at(t.page, "askFirst");
    await t.page.click(btn("askFirst", "A classmate or senior, in person"));
    assert.deepStrictEqual((await ans()).answerRight, [], "no other students asked, no answer about their answers");
    await t.page.click(btn("askFirst", "I haven't had a question like this"));
    assert.deepStrictEqual((await ans()).askFirst, ["I haven't had a question like this"], "I haven't had a question like this stands alone");
    // Answers that fit the earlier answer (D-129)
    await t.page.evaluate(() => { window.__survey.answers.residence = "A boarding house or apartment near campus"; window.__survey.go("whereFound"); });
    await at(t.page, "whereFound");
    opts = await shown("whereFound");
    assert.ok(!opts.includes("Applied for a VSU dorm") && opts.includes("A sign or tarpaulin outside"), "a renter sees no dorm application");
    assert.ok((await steps()).includes("housingSince"), "a renter is asked about trouble finding a place");
    await t.page.evaluate(() => window.__survey.go("home"));
    await at(t.page, "home");
    await t.page.click(btn("home", "An on-campus dorm"));
    await t.page.evaluate(() => window.__survey.go("whereFound"));
    await at(t.page, "whereFound");
    opts = await shown("whereFound");
    assert.ok(opts.includes("Applied for a VSU dorm") && !opts.includes("A sign or tarpaulin outside") && !opts.includes("Walking around and asking"), "a dorm resident sees the dorm application, not signs");
    await t.page.click(btn("whereFound", "Applied for a VSU dorm"));
    await t.page.evaluate(() => window.__survey.go("housingSince"));
    await at(t.page, "housingSince");
    await t.page.click(btn("housingSince", "Yes, once"));
    await t.page.evaluate(() => window.__survey.go("home"));
    await at(t.page, "home");
    await t.page.click(btn("home", "A boarding house or apartment near campus"));
    assert.strictEqual((await ans()).whereFound, null, "an answer that no longer fits is taken back");
    await t.page.click(btn("home", "My family's home, and I commute"));
    assert.ok(!(await steps()).includes("whereFound") && !(await steps()).includes("housingSince"), "no finding a place for a student who lives at home");
    assert.strictEqual((await ans()).housingSince, null, "and the housing answer is taken back");
    await t.page.evaluate(() => window.__survey.go("buySell"));
    await at(t.page, "buySell");
    await t.page.click(btn("buySell", "Group chats"));
    assert.ok((await steps()).includes("scamSince"));
    await t.page.click(btn("buySell", "I don't buy or sell with people on campus"));
    assert.ok(!(await steps()).includes("scamSince"), "no buying or selling, no question on scams");
    // The new-office question's follow-ups
    await t.page.evaluate(() => window.__survey.go("scenario"));
    await at(t.page, "scenario");
    await t.page.click(btn("scenario", "Walked over and asked around"));
    await next(t.page);
    await at(t.page, "whichOffice");
    await t.page.click(btn("whichOffice", "Cashier or accounting"));
    await t.page.click(btn("whichOffice", "Not sure"));
    assert.deepStrictEqual((await ans()).whichOffice, ["Not sure"], "Not sure stands alone");
    await next(t.page);
    await at(t.page, "visitsTook");
    await t.page.click(btn("visitsTook", "It still isn't done"));
    await t.page.evaluate(() => window.__survey.go("scenario"));
    await at(t.page, "scenario");
    await t.page.click(btn("scenario", "It hasn't happened to me"));
    a = await ans();
    assert.deepStrictEqual([a.scenario, a.whichOffice, a.visitsTook, a.missClass], [["It hasn't happened to me"], [], [], null], "It hasn't happened stands alone and clears the office follow-ups");
    assert.ok(!(await steps()).includes("whichOffice") && !(await steps()).includes("visitsTook") && !(await steps()).includes("missClass"));
    // Ranking the channels
    await t.page.evaluate(() => window.__survey.go("firstClasses"));
    await at(t.page, "firstClasses");
    for (const c of ["Email or text message", "Group chats: class, org, friends", "Campus bulletin boards", "In person: class or friends"]) await t.page.click(btn("firstClasses", c));
    assert.deepStrictEqual((await ans()).firstClasses, ["Email or text message", "Group chats: class, org, friends", "Campus bulletin boards"], "at most three, in the order picked");
    await t.page.click(btn("firstClasses", "Email or text message"));
    assert.deepStrictEqual((await ans()).firstClasses, ["Group chats: class, org, friends", "Campus bulletin boards"], "taking one back moves the rest up");
    assert.strictEqual(await t.page.locator(btn("firstClasses", "Group chats: class, org, friends")).getAttribute("data-rank"), "1st");
    await t.page.click(btn("firstClasses", "I don't hear about it"));
    assert.deepStrictEqual((await ans()).firstClasses, ["I don't hear about it"], "I don't hear about it stands alone");
    await t.page.click(btn("firstClasses", "Official VSU pages or website"));
    assert.deepStrictEqual((await ans()).firstClasses, ["Official VSU pages or website"], "and gives way to a channel");
    assert.strictEqual(await current(t.page), "firstClasses", "picking a channel doesn't move on by itself");
    await t.page.evaluate(() => window.__survey.go("worksWell"));
    await at(t.page, "worksWell");
    await t.page.click(btn("worksWell", "Nothing much"));
    await t.page.click(btn("worksWell", "News spreads fast"));
    assert.deepStrictEqual((await ans()).worksWell, ["News spreads fast"], "Nothing much gives way to a pick");
    await t.page.evaluate(() => window.__survey.go("whoRuns"));
    await at(t.page, "whoRuns");
    assert.strictEqual(await t.page.locator(btn("whoRuns", "None of these")).count(), 1, "trusting none of them is an answer");
    assert.strictEqual(await t.page.locator(".statement, .cal-marks, .pack").count(), 0, "no scene statements, calendars, or backpacks");
    assert.ok(!("board" in (await ans())), "nothing is asked how often or how much");
    const order = (await steps()).filter(x => ["classNews", "officialTell", "missedLate", "visitsTook", "reachHard", "concernHeard", "answerRight", "oldAnswer", "guideSteps", "seniorFind", "housingSince", "scamSince"].indexOf(x) >= 0);
    assert.deepStrictEqual(order, ["classNews", "officialTell", "missedLate", "oldAnswer", "guideSteps", "seniorFind"], "the problem questions follow the parts");
    assert.ok(!(await steps()).some(x => /Cost$/.test(x)), "no what-it-cost questions");
    assert.deepStrictEqual(t.errors, []);
    await t.ctx.close();
  });

  await check("the desk types each answer onto the form on its monitor, and hands the form over", async () => {
    const t = await open(browser, { mobile: true });
    await t.page.click("#start");
    await at(t.page, "consent");
    await t.page.click(inStep("consent", ".agree"));
    await at(t.page, "year");
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
    await at(t.page, "home");
    assert.ok(/\bskip\b/.test(await bar(1)), "a skip is typed in as a short grey line");
    assert.strictEqual(await t.page.locator('#passcard [data-f="program"]').textContent(), "Prefer not to say", "a line left blank reads Prefer not to say");
    assert.ok(/\bskip\b/.test(await bar(1)) && (await t.page.locator('[data-box="pass"] [data-mon="1"]').textContent()) === "Prefer not to say", "and the monitor types it in grey");
    await t.page.evaluate(() => window.__survey.go("support"));
    await at(t.page, "support");
    await t.page.click(btn("support", "A relative supports me"));
    assert.ok(/\bon\b/.test(await bar(3)), "a pick-all answer fills its line");
    await next(t.page);
    await at(t.page, "familyVSU");
    assert.ok(!(await t.page.evaluate(() => document.getElementById("passwrap").classList.contains("handing"))), "the form waits for the last question");
    await t.page.click(btn("familyVSU", "No, I'm the first in my family to study at VSU"));
    await t.page.waitForFunction(() => document.getElementById("passwrap").classList.contains("handing"), null, { timeout: 2500 });
    assert.strictEqual(await current(t.page), "familyVSU", "the walk waits while the pass is handed over");
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
    await at(t.page, "year");
    const steps = () => t.page.evaluate(() => window.__survey.steps());
    const ans = () => t.page.evaluate(() => window.__survey.answers);
    await t.page.evaluate(() => { window.__survey.answers.networks.push("Smart"); window.__survey.go("untilExpiry"); });
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
    assert.ok(await t.page.locator(btn("reloadWhy", "Both ran out")).isVisible(), "which data ran out is offered to everyone with a promo");
    await t.page.click(btn("reloadWhy", "Schoolwork couldn't wait"));
    await t.page.evaluate(() => window.__survey.go("reload"));
    await at(t.page, "reload");
    await t.page.click(btn("reload", "No, I connect to someone else's hotspot"));
    assert.deepStrictEqual((await ans()).reloadWhy, [], "not reloading clears the reasons for reloading");
    assert.ok(!(await steps()).includes("reloadWhy"));
    await t.page.evaluate(() => window.__survey.go("untilExpiry"));
    await at(t.page, "untilExpiry");
    await t.page.click(btn("untilExpiry", "It varies"));
    let a = await ans();
    assert.deepStrictEqual([a.untilExpiry, a.reload], ["It varies", null], "data that doesn't run out early clears the promo follow-ups");
    await t.page.click(btn("untilExpiry", "It varies"));
    await next(t.page);
    L = await steps();
    assert.ok(L.includes("untilExpiry") && !L.includes("reload"), "a skipped question drops its follow-ups");
    assert.deepStrictEqual(t.errors, []);
    await t.ctx.close();
  });

  await check("the receiver refuses records without consent, age, or the current version", async () => {
    const ok = { consent: true, age18: true, variant: "since", version: "since-v1" };
    assert.strictEqual(receiver.refusal_(ok), "");
    assert.ok(receiver.refusal_(Object.assign({}, ok, { consent: false })));
    assert.ok(receiver.refusal_(Object.assign({}, ok, { age18: false })));
    assert.ok(receiver.refusal_(Object.assign({}, ok, { version: "scenes-v3", variant: "scenes" })), "a scenes record is refused");
    assert.ok(receiver.refusal_(Object.assign({}, ok, { version: "last-time-v1", variant: "last-time" })), "a last-time record is refused");
    const h = receiver.headers_();
    assert.deepStrictEqual(h.slice(h.indexOf("year"), h.indexOf("year") + 8), ["year", "faculty", "program", "residence", "dormPart", "barangay", "org", "familyVSU"], "Your form's columns, in order");
    for (const k of ["rid", "stage", "more", "transport", "transferee", "firstGen"]) assert.ok(h.indexOf(k) < 0, "no " + k + " column");
    assert.strictEqual(receiver.cell_("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  });

  await browser.close();
  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
