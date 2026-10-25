/**
 * VSUrvey (formerly Istorya sa VSU): survey response receiver (since-v1)
 * Project CAMPUS, decisions D-037, D-039, D-110, and D-111
 *
 * Receives JSON records from the survey page and appends one row for each to a
 * private Google Sheet, one record for each respondent who sends. Interview
 * sign-ups go elsewhere: volunteer.html posts to volunteer-receiver.gs, its own
 * script in its own spreadsheet, so contact details never touch the survey data
 * (D-143). The Google Form this script used to build is retired.
 *
 * First-time setup
 * 1. Create a Google Sheet in your own account and keep it private.
 * 2. Extensions > Apps Script. Paste this file and save.
 * 3. Run setup() once and approve the permissions. It adds the "Responses since" tab and its header row.
 * 4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 5. Put the web app URL in the page's ENDPOINT.
 *
 * Updating from an earlier version
 * 1. Replace the old code with this file and save.
 * 2. Run setup(). It adds the "Responses since" tab; earlier tabs are left as they are.
 * 3. Deploy > Manage deployments > edit the web app > Version: New version > Deploy. The web app URL stays the same.
 *
 * The page posts plain text (no CORS preflight) and cannot read the reply,
 * so it treats "no network error" as sent.
 *
 * Privacy: Apps Script gives this script no IP address or other identifier
 * of the sender, and the script stores none. Free-text answers may still
 * contain names, so check them before quoting anyone. Rows marked test = TRUE
 * come from test runs; delete them.
 *
 * When a question or an option changes on the page, change the lists below.
 */

var SHEET_NAME = "Responses since";
var VARIANT = "since";
var VERSION_PREFIX = "since-v1";
/* Each problem is asked about since the respondent started at VSU, with all that have happened picked. */
var CLASS_NEWS = ["Before the class time", "On the way, or when I got to the room", "Only after the class time", "It hasn't happened"];
var OFFICIAL_TELL = ["Yes, right away", "Not at first, so I checked", "I couldn't tell", "I haven't seen one"];
var SCENARIO = ["Asked in a student Facebook group", "Messaged a friend or a senior", "Walked over and asked around", "Checked the official website or page", "Something else", "It hasn't happened to me"];
var OFFICE = ["Registrar or records", "Cashier or accounting", "My college or department office", "Student affairs or services", "Scholarships or financial aid", "Library, clinic, or another service", "Not sure"];
var VISITS = ["Just one", "Two or three", "Four or more", "It still isn't done"];
var REACH_WHY = ["A grade or a requirement", "A deadline or a schedule", "A signature or a document", "A question about a lesson",
  "An absence or a late submission", "Advice, like on a thesis or OJT", "Something else", "It hasn't happened"];
var REACH_HARD = ["They didn't reply, or replied days later", "I didn't know how to contact them", "They weren't in their office when I went",
  "I could only reach them through someone else, like a class rep", "I hesitated to ask", "It hasn't been hard"];
var ASK_FIRST = ["A group chat", "An unofficial student group or freedom wall", "A classmate or senior, in person", "A teacher or adviser",
  "Searched online", "I didn't look or ask anyone", "I haven't had a question like this"];
var ANSWER_RIGHT = ["They were right", "Some were wrong", "I couldn't tell", "I didn't get an answer"];
var OLD_ANSWER = ["Yes, quickly", "Yes, but it took a while", "No, so I asked again", "No, and I gave up", "I haven't looked for one"];
var GUIDE_STEPS = ["From an official guide that was up to date", "From an official guide that turned out to be out of date",
  "I couldn't find a guide, so I asked someone", "I couldn't find a guide, so I figured it out", "I haven't gone through one"];
var SENIOR_FIND = ["Yes, someone I already knew", "Yes, after asking around", "No, I couldn't find one", "It hasn't happened"];
var ORG_KINDS = ["A course or department org", "Academic or professional", "Sports", "Arts and culture", "Religious", "An interest club or hobby group",
  "A fraternity or sorority", "Political or advocacy", "Volunteer or community service", "Other"];
var ORG_RUN = ["Getting members to take part", "Reaching members with announcements", "Approvals and paperwork from offices",
  "Finding a venue or a schedule that works", "Funding", "Passing things on to the next officers", "Other"];
var ORG_KEEP = ["My friends are in it", "It helps my studies or career", "I believe in what it does", "Its events and activities", "It's expected, like in my course org", "Other"];
var ORG_WHY = ["It's hard to connect with the members", "I don't feel like taking part", "I don't have the time",
  "I don't hear about its activities in time", "Its activities don't interest me", "Fees or other costs", "Other"];
var ORG_NONE = ["I don't have the time", "I haven't found one that interests me", "There's no easy way to find orgs or join in",
  "I don't know anyone in them", "Fees or other costs", "I'm not interested in orgs", "Other"];
var SUPPORT = ["My parents or guardians send me money", "A relative supports me", "A scholarship or financial aid", "I work while studying", "My own savings"];
var GET_AROUND = ["A bicycle", "A motorcycle", "A car", "I ride along with family, a relative, or a friend", "None of these"];
var COMMUTE = ["Habal-habal", "Multicab", "Bus or van", "My own bicycle, motorcycle, or car", "A ride with family, a relative, or a friend", "Walk"];
var MISSED_LATE = ["A deadline or requirement, like for enrollment or clearance", "An event I wanted to join", "An org meeting or activity", "A seminar, training, or competition", "A scholarship or financial aid", "A part-time job or student assistant post", "An OJT host", "None of these"];
var FIRSTS = ["firstClasses", "firstSuspensions", "firstDocuments", "firstEvents", "firstScholarships", "firstAnnouncements"];  // each ranked up to three
var OFFICIAL_HOW = ["I get their notifications", "I check them myself", "Someone shares them with me", "They usually don't reach me"];
var CHECK_POST = ["Checked VSU's official page or website", "Asked a friend or classmate", "Asked in a group chat or group", "Asked an office or a teacher",
  "Waited for more posts", "I didn't check", "Other"];
var WHY_QUIET = ["I didn't know where to raise it", "I didn't think it would change anything", "I worried about the consequences",
  "It would take too much time or effort", "Someone else had already raised it", "Other"];
var JARS = ["online", "facilities", "news", "academic", "offices", "health", "services", "heard", "rooms", "teachers", "safety", "guides", "around", "aid", "housing", "storms", "food", "market"];  // 25 coins, up to 10 a jar
var HEARD = ["Yes, and it was fixed", "Yes, but it wasn't fixed", "It's still being looked into", "No, I never heard back"];
var FB_POSTING = ["Yes, under my real name", "Yes, under a nickname", "Yes, anonymously", "No, I only read", "No, I'm not in any"];
var CANT_GO_OUT = ["Ask a friend or classmate to buy it", "Use a pasabuy or delivery", "Wait until I can go", "Go without", "It doesn't happen to me"];
var BUY_SELL = ["Facebook groups or Marketplace", "Group chats", "In person on campus", "I don't buy or sell with people on campus"];
var WHO_JOIN = ["Faculty", "Office staff", "Student orgs and councils", "Alumni", "Incoming students", "Parents, relatives, or friends", "Only students"];
var CONCERN = ["Kept it to myself", "Told the office directly", "Told a teacher or adviser", "Went to the student council or an org",
  "Used a suggestion box or feedback form", "Raised it at a forum or dialogue", "Posted about it online",
  "Only talked about it with friends", "It hasn't happened"];
var WORKS = ["Everyone is already there", "News spreads fast", "Works with my load promo",
  "Easy to ask and get answers", "I can post without my name", "Easy to find the right people", "Nothing much", "Other"];
var NETWORKS = ["Smart", "TNT", "Globe", "TM", "GOMO", "DITO"];
var TWO_SIMS = ["To switch when one has weak signal", "My main SIM has weak signal on campus or where I reside", "One for data, one for calls and texts",
  "One for school, one for personal", "I pick each network's promo by need, like exam week", "No particular reason", "Other"];
var RELOAD_WHY = ["My open-access data ran out, but my app-only data didn't", "My app-only data ran out, but my open-access data didn't",
  "Both ran out", "Schoolwork couldn't wait", "To stay in touch with family or friends", "Other"];
var ONLINE_CAMPUS = ["Mobile data", "Campus Wi-Fi", "I usually can't", "I usually don't go online while on campus"];
var ONLINE_HOME = ["Mobile data", "Wi-Fi where I reside", "I usually can't"];
/* What students use mobile data for, grouped on the page by the kind of promo package each usually comes in. */
var DATA_USE = ["Facebook and Messenger", "TikTok", "Instagram", "X (Twitter)", "WhatsApp, Viber, or Telegram", "YouTube", "Netflix or other streaming",
  "Mobile games", "Google Classroom", "Google Docs, Drive, or Meet", "Zoom", "Canva", "AI apps, like ChatGPT or Gemini", "Browsing websites and searching", "Other"];
var WOULD_USE = ["Official answers from offices", "Easier to reach faculty and staff",
  "Notices and deadlines in one place", "Scholarships and opportunities in one place",
  "Events in one place", "Questions about my subjects", "My class schedule and rooms in one place",
  "A verified marketplace", "No ads or endless feeds", "Works on little mobile data", "Other"];
var AWAY = ["Feeling watched by the university", "Fear of consequences for criticism",
  "Too many apps already", "My friends wouldn't be on it", "Hard or slow to use",
  "Uses too much mobile data", "Other"];
var MAX_BODY = 60000;

function headers_() {
  var h = ["receivedAt", "startedAt", "sentAt", "survey", "variant", "version", "test", "consent", "age18",
    "year", "faculty", "program", "residence", "dormPart", "barangay", "org", "familyVSU"];
  multiHeaders_(h, "orgKinds", ORG_KINDS);
  multiHeaders_(h, "orgRun", ORG_RUN);
  multiHeaders_(h, "orgKeep", ORG_KEEP);
  multiHeaders_(h, "orgWhy", ORG_WHY);
  multiHeaders_(h, "orgNone", ORG_NONE);
  multiHeaders_(h, "support", SUPPORT);
  multiHeaders_(h, "network", NETWORKS);
  multiHeaders_(h, "twoSims", TWO_SIMS);
  h.push("dataSpend (week)");
  multiHeaders_(h, "dataUse", DATA_USE);
  h.push("untilExpiry", "reload");
  multiHeaders_(h, "reloadWhy", RELOAD_WHY);
  h.push("dataSchool", "signal");
  multiHeaders_(h, "onCampus", ONLINE_CAMPUS);
  multiHeaders_(h, "whereStaying", ONLINE_HOME);
  h.push("wifiSpend (month)", "hostedPay");
  FIRSTS.forEach(function (k) { h.push(k + " 1", k + " 2", k + " 3"); });
  h.push("groupChats");
  multiHeaders_(h, "officialHow", OFFICIAL_HOW);
  multiHeaders_(h, "classNews", CLASS_NEWS);
  multiHeaders_(h, "officialTell", OFFICIAL_TELL);
  multiHeaders_(h, "checkPost", CHECK_POST);
  multiHeaders_(h, "missedLate", MISSED_LATE);
  multiHeaders_(h, "scenario", SCENARIO);
  multiHeaders_(h, "whichOffice", OFFICE);
  multiHeaders_(h, "visitsTook", VISITS);
  multiHeaders_(h, "reachWhy", REACH_WHY);
  multiHeaders_(h, "reachHard", REACH_HARD);
  h.push("missClass");
  multiHeaders_(h, "concern", CONCERN);
  multiHeaders_(h, "whyQuiet", WHY_QUIET);
  multiHeaders_(h, "concernHeard", HEARD);
  multiHeaders_(h, "askFirst", ASK_FIRST);
  multiHeaders_(h, "answerRight", ANSWER_RIGHT);
  multiHeaders_(h, "oldAnswer", OLD_ANSWER);
  multiHeaders_(h, "guideSteps", GUIDE_STEPS);
  multiHeaders_(h, "seniorFind", SENIOR_FIND);
  multiHeaders_(h, "fbPosting", FB_POSTING);
  multiHeaders_(h, "getAround", GET_AROUND);
  multiHeaders_(h, "commute", COMMUTE);
  h.push("whereFound", "housingSince");
  multiHeaders_(h, "cantGoOut", CANT_GO_OUT);
  multiHeaders_(h, "buySell", BUY_SELL);
  h.push("scamSince");
  JARS.forEach(function (k) { h.push("coins: " + k); });
  h.push("jarOrder");
  multiHeaders_(h, "worksWell", WORKS);
  multiHeaders_(h, "wouldUse", WOULD_USE);
  multiHeaders_(h, "whoJoin", WHO_JOIN);
  h.push("postPreference", "wantBack", "whoRuns");
  multiHeaders_(h, "away", AWAY);
  h.push("comment", "raw");
  return h;
}

function multiHeaders_(h, prefix, options) {
  options.forEach(function (o) { h.push(prefix + ": " + o); });
  h.push(prefix + ": other text", prefix + ": unlisted");
}

/** One true/false column per known option, then the Other text, then anything unexpected. */
function multiCells_(row, values, options, otherText) {
  var v = Array.isArray(values) ? values.map(String) : [];
  options.forEach(function (o) { row.push(v.indexOf(o) >= 0); });
  row.push(cell_(otherText, 120), cell_(v.filter(function (x) { return options.indexOf(x) < 0; }).join("; ")));
}

/** Text for one cell: trimmed to size, and never read by Sheets as a formula. */
function cell_(v, max) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return isFinite(v) ? v : "";
  var s = String(v).slice(0, max || 200);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function num_(v, lo, hi) {
  var n = Number(v);
  return v !== null && v !== "" && isFinite(n) && n >= lo && n <= hi ? n : "";
}

function obj_(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }

function row_(r, now) {
  var coins = obj_(r.coins);
  var row = [now.toISOString(), cell_(r.startedAt), cell_(r.sentAt), cell_(r.survey), cell_(r.variant), cell_(r.version), r.test === true,
    r.consent === true, r.age18 === true, cell_(r.year), cell_(r.faculty, 100), cell_(r.program, 100),
    cell_(r.residence), cell_(r.dormPart), cell_(r.barangay), cell_(r.org), cell_(r.familyVSU)];
  multiCells_(row, r.orgKinds, ORG_KINDS, r.orgKindsOther);
  multiCells_(row, r.orgRun, ORG_RUN, r.orgRunOther);
  multiCells_(row, r.orgKeep, ORG_KEEP, r.orgKeepOther);
  multiCells_(row, r.orgWhy, ORG_WHY, r.orgWhyOther);
  multiCells_(row, r.orgNone, ORG_NONE, r.orgNoneOther);
  multiCells_(row, r.support, SUPPORT, "");
  multiCells_(row, r.networks, NETWORKS, "");
  multiCells_(row, r.twoSims, TWO_SIMS, r.twoSimsOther);
  row.push(cell_(r.dataSpend));
  multiCells_(row, r.dataUse, DATA_USE, r.dataUseOther);
  row.push(cell_(r.untilExpiry), cell_(r.reload));
  multiCells_(row, r.reloadWhy, RELOAD_WHY, r.reloadWhyOther);
  row.push(cell_(r.dataSchool), cell_(r.signal));
  multiCells_(row, r.onlineCampus, ONLINE_CAMPUS, "");
  multiCells_(row, r.onlineHome, ONLINE_HOME, "");
  row.push(cell_(r.wifiSpend), cell_(r.hostedPay));
  FIRSTS.forEach(function (k) { var v = Array.isArray(r[k]) ? r[k] : []; row.push(cell_(v[0]), cell_(v[1]), cell_(v[2])); });
  row.push(cell_(r.groupChats));
  multiCells_(row, r.officialHow, OFFICIAL_HOW, "");
  multiCells_(row, r.classNews, CLASS_NEWS, "");
  multiCells_(row, r.officialTell, OFFICIAL_TELL, "");
  multiCells_(row, r.checkPost, CHECK_POST, r.checkPostOther);
  multiCells_(row, r.missedLate, MISSED_LATE, "");
  multiCells_(row, r.scenario, SCENARIO, "");
  multiCells_(row, r.whichOffice, OFFICE, "");
  multiCells_(row, r.visitsTook, VISITS, "");
  multiCells_(row, r.reachWhy, REACH_WHY, "");
  multiCells_(row, r.reachHard, REACH_HARD, "");
  row.push(cell_(r.missClass));
  multiCells_(row, r.concern, CONCERN, "");
  multiCells_(row, r.whyQuiet, WHY_QUIET, r.whyQuietOther);
  multiCells_(row, r.concernHeard, HEARD, "");
  multiCells_(row, r.askFirst, ASK_FIRST, "");
  multiCells_(row, r.answerRight, ANSWER_RIGHT, "");
  multiCells_(row, r.oldAnswer, OLD_ANSWER, "");
  multiCells_(row, r.guideSteps, GUIDE_STEPS, "");
  multiCells_(row, r.seniorFind, SENIOR_FIND, "");
  multiCells_(row, r.fbPosting, FB_POSTING, "");
  multiCells_(row, r.getAround, GET_AROUND, "");
  multiCells_(row, r.commute, COMMUTE, "");
  row.push(cell_(r.whereFound), cell_(r.housingSince));
  multiCells_(row, r.cantGoOut, CANT_GO_OUT, "");
  multiCells_(row, r.buySell, BUY_SELL, "");
  row.push(cell_(r.scamSince));
  JARS.forEach(function (k) { row.push(num_(coins[k], 1, 10)); });  // at most 10 in a jar
  row.push(cell_(r.jarOrder, 300));  // the order the jars were shown in, random for each respondent
  multiCells_(row, r.worksWell, WORKS, r.worksWellOther);
  multiCells_(row, r.wouldUse, WOULD_USE, r.wouldUseOther);
  multiCells_(row, r.whoJoin, WHO_JOIN, "");
  row.push(cell_(r.postPreference), cell_(r.wantBack), cell_(r.whoRuns));
  multiCells_(row, r.keepAway, AWAY, r.keepAwayOther);
  row.push(cell_(r.comment, 1000), cell_(JSON.stringify(r), 45000));
  return row;
}

/** Why a record is refused, or "" if it is accepted. */
function refusal_(r) {
  if (!r || typeof r !== "object") return "not a record";
  if (r.consent !== true) return "no consent";
  if (r.age18 !== true) return "not confirmed 18 or older";
  if (r.variant !== VARIANT) return "unknown variant";
  if (String(r.version || "").indexOf(VERSION_PREFIX) !== 0) return "old version";
  return "";
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = e && e.postData ? String(e.postData.contents || "") : "";
    if (!body || body.length > MAX_BODY) return reply_({ ok: false, error: "empty or too large" });
    var r = JSON.parse(body);
    var why = refusal_(r);
    if (why) return reply_({ ok: false, error: why });
    lock.waitLock(10000);
    sheet_().appendRow(row_(r, new Date()));
    return reply_({ ok: true });
  } catch (err) {
    return reply_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function doGet() { return reply_({ ok: true, service: "VSUrvey receiver", version: VERSION_PREFIX }); }

function reply_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) { sh.appendRow(headers_()); sh.setFrozenRows(1); }
  return sh;
}

function setup() { sheet_(); }

if (typeof module !== "undefined") module.exports = { headers_: headers_, row_: row_, cell_: cell_, refusal_: refusal_, FIRSTS: FIRSTS, OFFICIAL_HOW: OFFICIAL_HOW, CHECK_POST: CHECK_POST, WHY_QUIET: WHY_QUIET, CONCERN: CONCERN, WORKS: WORKS, NETWORKS: NETWORKS, DATA_USE: DATA_USE, TWO_SIMS: TWO_SIMS, RELOAD_WHY: RELOAD_WHY, ONLINE_CAMPUS: ONLINE_CAMPUS, ONLINE_HOME: ONLINE_HOME, WOULD_USE: WOULD_USE, AWAY: AWAY, JARS: JARS, MISSED_LATE: MISSED_LATE, CLASS_NEWS: CLASS_NEWS, OFFICIAL_TELL: OFFICIAL_TELL, SCENARIO: SCENARIO, OFFICE: OFFICE, VISITS: VISITS, REACH_WHY: REACH_WHY, REACH_HARD: REACH_HARD, ASK_FIRST: ASK_FIRST, ANSWER_RIGHT: ANSWER_RIGHT, OLD_ANSWER: OLD_ANSWER, GUIDE_STEPS: GUIDE_STEPS, SENIOR_FIND: SENIOR_FIND, GET_AROUND: GET_AROUND, ORG_KINDS: ORG_KINDS, ORG_RUN: ORG_RUN, ORG_KEEP: ORG_KEEP, ORG_WHY: ORG_WHY, ORG_NONE: ORG_NONE, SUPPORT: SUPPORT, COMMUTE: COMMUTE, WHO_JOIN: WHO_JOIN, HEARD: HEARD, FB_POSTING: FB_POSTING, CANT_GO_OUT: CANT_GO_OUT, BUY_SELL: BUY_SELL };
