/**
 * VSUrvey (formerly Istorya sa VSU): survey response receiver and volunteer form (last-time-v1)
 * Project CAMPUS, decisions D-037, D-039, D-110, and D-111
 *
 * Receives JSON records from the survey page and appends one row for each to a
 * private Google Sheet, one record for each respondent who sends. It also builds
 * and updates the separate interview-volunteer form, so contact details never touch the
 * survey data.
 *
 * First-time setup
 * 1. Create a Google Sheet in your own account and keep it private.
 * 2. Extensions > Apps Script. Paste this file and save.
 * 3. Run setup() once and approve the permissions. It adds the "Responses last-time" tab and its header row.
 * 4. Run createVolunteerForm() once. The execution log shows the form's link.
 * 5. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 6. Put the web app URL in the page's ENDPOINT, and the form link in VOLUNTEER_URL.
 *
 * Updating from an earlier version
 * 1. Replace the old code with this file and save.
 * 2. Run setup(). It adds the "Responses last-time" tab; earlier tabs are left as they are.
 * 3. Run updateVolunteerForm() once. It edits the existing form in place, so its link stays the same.
 * 4. Deploy > Manage deployments > edit the web app > Version: New version > Deploy. The web app URL stays the same.
 *
 * The page posts plain text (no CORS preflight) and cannot read the reply,
 * so it treats "no network error" as sent.
 *
 * Privacy: Apps Script gives this script no IP address or other identifier
 * of the sender, and the script stores none. The record ID is a random number
 * the page makes for one sitting; it says nothing about the respondent. Free-text answers may still
 * contain names, so check them before quoting anyone. Rows marked test = TRUE
 * come from test runs; delete them.
 *
 * When a question or an option changes on the page, change the lists below.
 */

var SHEET_NAME = "Responses last-time";
var VARIANT = "last-time";
var VERSION_PREFIX = "last-time-v1";
/* What it cost, asked after an answer that names a problem: one list for every problem. */
var COST = ["Nothing much", "Time: an extra trip, a wait, or asking around", "Something I missed: a class, a deadline, or a chance", "Money", "Not sure"];
var COSTS = ["classCost", "officialCost", "missedCost", "visitsCost", "reachCost", "heardCost", "answerCost", "oldCost", "guideCost", "seniorCost", "housingCost", "scamCost"];
var MISSED_LATE = ["An event I wanted to join", "A scholarship or financial aid", "A part-time job or student assistant post", "An OJT host", "None of these"];
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
var WHO_JOIN = ["Faculty", "Office staff", "Student orgs and councils", "Alumni", "Incoming students", "Only students"];
var CONCERN = ["Kept it to myself", "Told the office directly", "Told a teacher or adviser", "Went to the student council or an org",
  "Used a suggestion box or feedback form", "Raised it at a forum or dialogue", "Posted about it online",
  "Only talked about it with friends", "It hasn't happened"];
var WORKS = ["Everyone is already there", "News spreads fast", "Works with my load promo",
  "Easy to ask and get answers", "I can post without my name", "Easy to find the right people", "Nothing much", "Other"];
var NETWORKS = ["Smart", "TNT", "Globe", "TM", "GOMO", "DITO"];
var TWO_SIMS = ["To switch when one has weak signal", "My main SIM has weak signal on campus or where I stay", "One for data, one for calls and texts",
  "One for school, one for personal", "I pick each network's promo by need, like exam week", "No particular reason", "Other"];
var RELOAD_WHY = ["My open-access data ran out, but my app-only data didn't", "My app-only data ran out, but my open-access data didn't",
  "Both ran out", "Schoolwork couldn't wait", "To stay in touch with family or friends", "Other"];
var LOAD = ["Data for any site or app", "Data for certain apps only", "Calls and texts", "A postpaid plan", "I don't use load"];
var ONLINE_CAMPUS = ["Mobile data", "Campus Wi-Fi", "I usually can't"];
var ONLINE_HOME = ["Mobile data", "Wi-Fi where I stay", "I usually can't"];
var LOAD_APPS = ["Facebook and Messenger", "TikTok", "YouTube", "Instagram", "X (Twitter)", "WhatsApp or Viber",
  "Netflix or other streaming", "Games", "School apps, like Google Workspace, Zoom, or Canva", "Other"];
var WOULD_USE = ["Official answers from offices", "Easier to reach faculty and staff",
  "Notices and deadlines in one place", "Scholarships and opportunities in one place",
  "Events in one place", "Questions about my subjects", "My class schedule and rooms in one place",
  "A marketplace only for VSU people", "No ads or endless feeds", "Works on little mobile data", "Other"];
var AWAY = ["Feeling watched by the university", "Fear of consequences for criticism",
  "Too many apps already", "My friends wouldn't be on it", "Hard or slow to use",
  "Uses too much mobile data", "Other"];
var MAX_BODY = 60000;

/* The interview-volunteer form. Its ID only opens it for accounts with edit access. */
var VOLUNTEER_FORM_ID = "1Hu0n10kftKOt25554Rtn8HVR066-6BDy6B-9pCDZS5I";
var FACULTIES = ["Faculty of Agriculture and Food Science", "Faculty of Computing", "Faculty of Engineering",
  "Faculty of Forestry and Environmental Science", "Faculty of Humanities and Social Sciences",
  "Faculty of Management and Economics", "Faculty of Natural and Mathematical Sciences", "Faculty of Nursing",
  "Faculty of Teacher Education", "Faculty of Veterinary Medicine", "Another unit"];
var VOLUNTEER_TITLE = "VSUrvey: interview volunteers";
var VOLUNTEER_THANKS = "Thank you. I'll message you to set a time. Your survey answers stay separate from your name.";
var FACULTY_TITLE = "Faculty";
var FACULTY_HELP = "Optional. Pick the faculty your department or institute is part of. If it isn't one of these, choose Another unit.";
var VOLUNTEER_DESCRIPTION = "Thank you for offering to talk. This form is separate from the survey, so your name never meets your survey answers. " +
  "Leo M. Subingsubing, a VSU alumnus, will contact you to set a time for a 30-minute interview for Project CAMPUS, an independent proposal. " +
  "It is not an official VSU study. Your contact details are used only to arrange the interview. Only Leo sees them, and they are deleted " +
  "once your interview is done, or three months after you sign up if you aren't interviewed.";

function headers_() {
  var h = ["receivedAt", "startedAt", "sentAt", "survey", "variant", "version", "test", "consent", "age18",
    "residence", "barangay", "transport", "year", "faculty", "org", "scholarship", "transferee", "firstGen", "familyVSU"];
  multiHeaders_(h, "network", NETWORKS);
  multiHeaders_(h, "twoSims", TWO_SIMS);
  multiHeaders_(h, "load", LOAD);
  multiHeaders_(h, "loadApps", LOAD_APPS);
  h.push("validity", "untilExpiry", "reload");
  multiHeaders_(h, "reloadWhy", RELOAD_WHY);
  h.push("dataSpend (week)", "dataSchool", "signal");
  multiHeaders_(h, "onCampus", ONLINE_CAMPUS);
  multiHeaders_(h, "whereStaying", ONLINE_HOME);
  h.push("wifiSpend (month)", "hostedPay");
  FIRSTS.forEach(function (k) { h.push(k + " 1", k + " 2", k + " 3"); });
  h.push("groupChats");
  multiHeaders_(h, "officialHow", OFFICIAL_HOW);
  h.push("classLast", "officialLast");
  multiHeaders_(h, "checkPost", CHECK_POST);
  multiHeaders_(h, "missedLate", MISSED_LATE);
  h.push("scenario", "whichOffice", "visitsTook", "reachHow", "reachGot", "missClass");
  multiHeaders_(h, "concern", CONCERN);
  multiHeaders_(h, "whyQuiet", WHY_QUIET);
  h.push("concernHeard", "askFirst", "answerRight", "oldAnswer", "guideLast", "seniorLast");
  multiHeaders_(h, "fbPosting", FB_POSTING);
  h.push("whereFound", "housingSince");
  multiHeaders_(h, "cantGoOut", CANT_GO_OUT);
  multiHeaders_(h, "buySell", BUY_SELL);
  h.push("scamSince");
  COSTS.forEach(function (k) { multiHeaders_(h, k, COST); });
  JARS.forEach(function (k) { h.push("coins: " + k); });
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
    r.consent === true, r.age18 === true, cell_(r.residence), cell_(r.barangay), cell_(r.transport), cell_(r.year), cell_(r.faculty, 100),
    cell_(r.org), cell_(r.scholarship), cell_(r.transferee), cell_(r.firstGen), cell_(r.familyVSU)];
  multiCells_(row, r.networks, NETWORKS, "");
  multiCells_(row, r.twoSims, TWO_SIMS, r.twoSimsOther);
  multiCells_(row, r.load, LOAD, "");
  multiCells_(row, r.loadApps, LOAD_APPS, r.loadAppsOther);
  row.push(cell_(r.validity), cell_(r.untilExpiry), cell_(r.reload));
  multiCells_(row, r.reloadWhy, RELOAD_WHY, r.reloadWhyOther);
  row.push(cell_(r.dataSpend), cell_(r.dataSchool), cell_(r.signal));
  multiCells_(row, r.onlineCampus, ONLINE_CAMPUS, "");
  multiCells_(row, r.onlineHome, ONLINE_HOME, "");
  row.push(cell_(r.wifiSpend), cell_(r.hostedPay));
  FIRSTS.forEach(function (k) { var v = Array.isArray(r[k]) ? r[k] : []; row.push(cell_(v[0]), cell_(v[1]), cell_(v[2])); });
  row.push(cell_(r.groupChats));
  multiCells_(row, r.officialHow, OFFICIAL_HOW, "");
  row.push(cell_(r.classLast), cell_(r.officialLast));
  multiCells_(row, r.checkPost, CHECK_POST, r.checkPostOther);
  multiCells_(row, r.missedLate, MISSED_LATE, "");
  row.push(cell_(r.scenario), cell_(r.whichOffice), cell_(r.visitsTook), cell_(r.reachHow), cell_(r.reachGot), cell_(r.missClass));
  multiCells_(row, r.concern, CONCERN, "");
  multiCells_(row, r.whyQuiet, WHY_QUIET, r.whyQuietOther);
  row.push(cell_(r.concernHeard), cell_(r.askFirst), cell_(r.answerRight), cell_(r.oldAnswer), cell_(r.guideLast), cell_(r.seniorLast));
  multiCells_(row, r.fbPosting, FB_POSTING, "");
  row.push(cell_(r.whereFound), cell_(r.housingSince));
  multiCells_(row, r.cantGoOut, CANT_GO_OUT, "");
  multiCells_(row, r.buySell, BUY_SELL, "");
  row.push(cell_(r.scamSince));
  COSTS.forEach(function (k) { multiCells_(row, r[k], COST, ""); });
  JARS.forEach(function (k) { row.push(num_(coins[k], 1, 10)); });  // at most 10 in a jar
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

/**
 * Builds the separate interview-volunteer form. Its answers stay inside the
 * form, not in the survey sheet, so contact details never meet survey answers.
 * Delete each volunteer's response once their interview is done, or three
 * months after they sign up if they aren't interviewed (D-111).
 */
function createVolunteerForm() {
  var form = FormApp.create(VOLUNTEER_TITLE);
  form.setDescription(VOLUNTEER_DESCRIPTION);
  form.addTextItem().setTitle("What should I call you?").setHelpText("A first name or a nickname is enough.").setRequired(true);
  form.addTextItem().setTitle("How can I reach you?").setHelpText("A mobile number, a Messenger name, or an email address.").setRequired(true);
  form.addMultipleChoiceItem().setTitle("Year level")
    .setChoiceValues(["1st", "2nd", "3rd", "4th", "5th or higher", "Graduate student"]).setRequired(true);
  form.addMultipleChoiceItem().setTitle(FACULTY_TITLE).setHelpText(FACULTY_HELP).setChoiceValues(FACULTIES);
  form.addMultipleChoiceItem().setTitle("During the semester, I live in")
    .setChoiceValues(["An on-campus dorm", "A boarding house or apartment near campus", "My family's home, and I commute", "Somewhere else"]).setRequired(true);
  form.addMultipleChoiceItem().setTitle("In student organizations, I am")
    .setChoiceValues(["An officer", "A member", "Neither"]).setRequired(true);
  form.addCheckboxItem().setTitle("When are you usually free?")
    .setChoiceValues(["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Weekends"]);
  form.addCheckboxItem().setTitle("Consent")
    .setChoiceValues(["I am a current VSU Main Campus student, I am 18 or older, and I agree to be contacted about an interview."]).setRequired(true);
  form.setConfirmationMessage(VOLUNTEER_THANKS);
  Logger.log("Volunteer form link: " + form.getPublishedUrl());
  Logger.log("Edit it here: " + form.getEditUrl());
  return form.getPublishedUrl();
}

/**
 * Brings the existing volunteer form up to date without changing its link:
 * the survey's new name, the retention sentence (D-111), a fixed faculty list
 * in place of the free-text "College or department", and the thank-you note.
 * Safe to run more than once.
 */
function updateVolunteerForm() {
  var form = FormApp.openById(VOLUNTEER_FORM_ID);
  form.setTitle(VOLUNTEER_TITLE);
  form.setDescription(VOLUNTEER_DESCRIPTION);
  form.setConfirmationMessage(VOLUNTEER_THANKS);
  var items = form.getItems();
  var hasFaculty = items.some(function (it) { return it.getTitle() === FACULTY_TITLE; });
  items.forEach(function (it) {
    if (it.getTitle() !== "College or department") return;
    var at = it.getIndex();
    form.deleteItem(it);
    if (!hasFaculty) {
      var faculty = form.addMultipleChoiceItem().setTitle(FACULTY_TITLE).setHelpText(FACULTY_HELP).setChoiceValues(FACULTIES);
      form.moveItem(faculty, at);
      hasFaculty = true;
    }
  });
  Logger.log("Updated the volunteer form. Its link is unchanged: " + form.getPublishedUrl());
}

if (typeof module !== "undefined") module.exports = { headers_: headers_, row_: row_, cell_: cell_, refusal_: refusal_, FIRSTS: FIRSTS, OFFICIAL_HOW: OFFICIAL_HOW, CHECK_POST: CHECK_POST, WHY_QUIET: WHY_QUIET, CONCERN: CONCERN, WORKS: WORKS, NETWORKS: NETWORKS, LOAD: LOAD, LOAD_APPS: LOAD_APPS, TWO_SIMS: TWO_SIMS, RELOAD_WHY: RELOAD_WHY, ONLINE_CAMPUS: ONLINE_CAMPUS, ONLINE_HOME: ONLINE_HOME, WOULD_USE: WOULD_USE, AWAY: AWAY, JARS: JARS, COST: COST, COSTS: COSTS, MISSED_LATE: MISSED_LATE, WHO_JOIN: WHO_JOIN, HEARD: HEARD, FB_POSTING: FB_POSTING, CANT_GO_OUT: CANT_GO_OUT, BUY_SELL: BUY_SELL };
