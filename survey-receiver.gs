/**
 * VSUrvey (formerly Istorya sa VSU): survey response receiver and volunteer form (scenes-v2)
 * Project CAMPUS, decisions D-037, D-039, D-110, and D-111
 *
 * Receives one JSON record per response from the scenes survey page and
 * appends one row to a private Google Sheet. It also builds and updates the
 * separate interview-volunteer form, so contact details never touch the
 * survey data.
 *
 * First-time setup
 * 1. Create a Google Sheet in your own account and keep it private.
 * 2. Extensions > Apps Script. Paste this file and save.
 * 3. Run setup() once and approve the permissions. It adds the "Responses v2" tab and its header row.
 * 4. Run createVolunteerForm() once. The execution log shows the form's link.
 * 5. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 6. Put the web app URL in the page's ENDPOINT, and the form link in VOLUNTEER_URL.
 *
 * Updating from scenes-v1
 * 1. Replace the old code with this file and save.
 * 2. Run setup(). It adds the "Responses v2" tab; the v1 "Responses" tab is left as it is.
 * 3. Run updateVolunteerForm() once. It edits the existing form in place, so its link stays the same.
 * 4. Deploy > Manage deployments > edit the web app > Version: New version > Deploy. The web app URL stays the same.
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

var SHEET_NAME = "Responses v2";
var VARIANT = "scenes";
var VERSION_PREFIX = "scenes-v2";
var MOMENTS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o"];
var SOURCES = ["Official VSU website or portal", "Official VSU Facebook pages",
  "Unofficial student Facebook groups or pages", "Messenger group chats", "Email",
  "Campus bulletin boards", "Friends and classmates", "Other", "None of these"];
var WOULD_USE = ["Official answers from offices", "Easier to reach faculty and staff",
  "Notices and deadlines in one place", "Scholarships and opportunities in one place",
  "Events in one place", "Questions about my subjects", "My class schedule and rooms in one place",
  "A marketplace only for VSU people", "No ads or endless feeds", "Works on little mobile data", "Other"];
var AWAY = ["Feeling watched by the university", "Fear of consequences for criticism",
  "Too many apps already", "My friends wouldn't be on it", "Hard or slow to use",
  "Uses too much mobile data", "Other"];
var MAX_PINS = 3;
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
  var h = ["receivedAt", "startedAt", "sentAt", "variant", "version", "test", "consent", "age18",
    "residence", "year", "faculty", "org", "scholarship", "firstGen"];
  multiHeaders_(h, "uses", SOURCES);
  h.push("mainSource", "dataSpend", "dataSchool", "online", "scenario");
  MOMENTS.forEach(function (k) { h.push(k + " often", k + " matters"); });
  MOMENTS.forEach(function (k) { h.push(k + " coins"); });
  for (var i = 1; i <= MAX_PINS; i++) h.push("pin" + i + " near", "pin" + i + " why", "pin" + i + " x", "pin" + i + " y");
  h.push("trust", "postedAnonymously");
  multiHeaders_(h, "wouldUse", WOULD_USE);
  h.push("postPreference");
  multiHeaders_(h, "away", AWAY);
  h.push("story", "mayQuote", "comment", "raw");
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
  var board = obj_(r.board), coins = obj_(r.coins);
  var pins = Array.isArray(r.pins) ? r.pins.slice(0, MAX_PINS) : [];
  var row = [now.toISOString(), cell_(r.startedAt), cell_(r.sentAt), cell_(r.variant), cell_(r.version), r.test === true,
    r.consent === true, r.age18 === true, cell_(r.residence), cell_(r.year), cell_(r.faculty, 100),
    cell_(r.org), cell_(r.scholarship), cell_(r.firstGen)];
  multiCells_(row, r.sources, SOURCES, r.sourcesOther);
  row.push(cell_(r.mainSource), cell_(r.dataSpend), cell_(r.dataSchool), cell_(r.online), cell_(r.scenario));
  MOMENTS.forEach(function (k) { var a = obj_(board[k]); row.push(cell_(a.often), cell_(a.matters)); });
  MOMENTS.forEach(function (k) { row.push(num_(coins[k], 1, 10)); });
  for (var i = 0; i < MAX_PINS; i++) {
    var p = obj_(pins[i]);
    row.push(cell_(p.near), cell_(p.why), num_(p.x, 0, 400), num_(p.y, 0, 400));
  }
  row.push(num_(r.trust, 1, 5), cell_(r.postedAnonymously));
  multiCells_(row, r.wouldUse, WOULD_USE, r.wouldUseOther);
  row.push(cell_(r.postPreference));
  multiCells_(row, r.keepAway, AWAY, r.keepAwayOther);
  row.push(cell_(r.story, 5000), r.mayQuote === true, cell_(r.comment, 1000), cell_(JSON.stringify(r), 45000));
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

if (typeof module !== "undefined") module.exports = { headers_: headers_, row_: row_, cell_: cell_, refusal_: refusal_, SOURCES: SOURCES, WOULD_USE: WOULD_USE, AWAY: AWAY, MOMENTS: MOMENTS };
