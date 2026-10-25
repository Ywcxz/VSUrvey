/**
 * VSUrvey: interview sign-up receiver (volunteer-v1)
 * Project CAMPUS, decisions D-039, D-086, D-111, and D-143
 *
 * Receives sign-ups from volunteer.html and appends one row for each to a
 * private Google Sheet of its own. It is a separate script, in a separate
 * spreadsheet, from survey-receiver.gs, so contact details never meet survey
 * answers: neither script can read the other's sheet.
 *
 * First-time setup
 * 1. Create a NEW Google Sheet in your own account, separate from the survey's sheet, and keep it private.
 * 2. Extensions > Apps Script. Paste this file and save.
 * 3. Run setup() once and approve the permissions. It adds the "Sign-ups" tab and its header row,
 *    and a daily clean-up that deletes sign-ups as D-111 says (see purge below).
 * 4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 5. Put the web app URL in volunteer.html's ENDPOINT, through a pull request.
 * 6. Optional: in the sheet, Tools > Notification settings > Edit notifications, to get an email
 *    when a row is added. The email says the sheet changed; it carries no contact details.
 *
 * Updating
 * 1. Replace the old code with this file and save.
 * 2. Deploy > Manage deployments > edit the web app > Version: New version > Deploy. The URL stays the same.
 *
 * After each interview, tick the row's "interviewDone" box. The daily clean-up deletes ticked rows,
 * rows three months old, and test rows a day old. Run purge() by hand to delete them at once.
 *
 * Privacy: Apps Script gives this script no IP address or other identifier of the sender, and the
 * script stores none. The survey's last screen leads here, so a sign-up often arrives seconds after
 * that student's survey answer. To keep the two from being matched (D-143), this sheet keeps only
 * the day of signing up, never the time, and puts each new row at a random place, not at the bottom.
 * Never set the two sheets side by side to match them. Never copy these rows into the survey's sheet, the repositories, or interview
 * notes (D-086); notes carry a number, never a name.
 */

var SHEET_NAME = "Sign-ups";
var FORM = "volunteer";
var VERSION_PREFIX = "v1";
var KEEP_DAYS = 90;        // three months after signing up, if there was no interview (D-111)
var KEEP_TEST_DAYS = 1;    // rows from ?test=1 runs
var MAX_BODY = 4000;

/* The page's options, as in the survey (index.html). Anything else is left blank. */
var YEARS = ["1st", "2nd", "3rd", "4th", "5th or higher"];
var FACULTIES = ["Agriculture and Food Science", "Computing", "Engineering", "Forestry and Environmental Science", "Humanities and Social Sciences",
  "Management and Economics", "Natural and Mathematical Sciences", "Nursing", "Teacher Education", "Veterinary Medicine"];
var RESIDENCE = ["An on-campus dorm", "A boarding house or apartment near campus", "My family's home, and I commute", "A relative's or friend's house", "Somewhere else"];
var ORG = ["An officer or leader", "An active member", "A member, but I rarely take part", "Not a member of any"];
var FREE = ["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Weekends"];

function headers_() {
  return ["signedUpOn", "deleteBy", "test", "name", "contact", "year", "faculty", "residence", "org", "free", "interviewDone"];
}

/* A value a sheet would read as a formula is kept as text. */
function cell_(v, max) {
  if (v === null || v === undefined) return "";
  var s = String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max || 120);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/* The day in the Philippines (UTC+8), as 2026-10-25, with no time. */
function day_(d) { return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10); }

/* Where a new row goes: after a random one of the rows there, so the order of rows says nothing about when each came. */
function slot_(last, rand) { return 1 + Math.floor(rand * Math.max(last, 1)); }

function pick_(v, list) { return list.indexOf(v) >= 0 ? v : ""; }

function picks_(v, list) {
  if (!Array.isArray(v)) return "";
  return list.filter(function (o) { return v.indexOf(o) >= 0; }).join(", ");
}

function row_(r, now) {
  var deleteBy = new Date(now.getTime() + (r.test === true ? KEEP_TEST_DAYS : KEEP_DAYS) * 86400000);
  return [day_(now), day_(deleteBy), r.test === true,
    cell_(r.name, 60), cell_(r.contact, 120),
    pick_(r.year, YEARS), pick_(r.faculty, FACULTIES), pick_(r.residence, RESIDENCE), pick_(r.org, ORG), picks_(r.free, FREE),
    false];
}

function refusal_(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return "not a record";
  if (r.form !== FORM) return "not a sign-up";
  if (String(r.version || "").indexOf(VERSION_PREFIX) !== 0) return "old version";
  if (r.consent !== true) return "no consent";
  if (r.age18 !== true) return "not confirmed 18 or older";
  if (!cell_(r.name, 60)) return "no name";
  if (!cell_(r.contact, 120)) return "no contact";
  return "";
}

/* Which rows the clean-up deletes, counted from the bottom so deleting doesn't shift the rest. */
function expired_(values, now) {
  var h = headers_(), at = h.indexOf("signedUpOn"), test = h.indexOf("test"), done = h.indexOf("interviewDone"), out = [];
  for (var i = values.length - 1; i >= 1; i--) {
    var v = values[i], got = new Date(v[at]), age = (now.getTime() - got.getTime()) / 86400000;
    if (v[done] === true || isNaN(age) || age >= KEEP_DAYS || (v[test] === true && age >= KEEP_TEST_DAYS)) out.push(i + 1);
  }
  return out;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = e && e.postData ? String(e.postData.contents || "") : "";
    if (!body || body.length > MAX_BODY) return reply_({ ok: false, error: "empty or too long" });
    var r = JSON.parse(body);
    var why = refusal_(r);
    if (why) return reply_({ ok: false, error: why });
    lock.waitLock(10000);
    var sh = sheet_();
    var row = row_(r, new Date()), after = slot_(sh.getLastRow(), Math.random());
    sh.insertRowAfter(after);
    sh.getRange(after + 1, 1, 1, row.length).setValues([row]);
    sh.getRange(after + 1, headers_().indexOf("interviewDone") + 1).insertCheckboxes();
    return reply_({ ok: true });
  } catch (err) {
    return reply_({ ok: false, error: "could not save" });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function doGet() { return reply_({ ok: true, service: "VSUrvey interview sign-up", version: VERSION_PREFIX }); }

function reply_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers_());
    sh.setFrozenRows(1);
  }
  return sh;
}

/* Deletes ticked, three-month-old, and old test rows. setup() runs it every day. */
function purge() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = sheet_(), values = sh.getDataRange().getValues(), rows = expired_(values, new Date());
    rows.forEach(function (n) { sh.deleteRow(n); });
    Logger.log("Deleted " + rows.length + " sign-up(s).");
  } finally {
    lock.releaseLock();
  }
}

function setup() {
  sheet_();
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "purge"; });
  if (!has) ScriptApp.newTrigger("purge").timeBased().everyDays(1).atHour(3).create();
  Logger.log("Ready. Deploy this script as a web app, then put its URL in volunteer.html's ENDPOINT.");
}

if (typeof module !== "undefined") module.exports = { headers_: headers_, row_: row_, day_: day_, slot_: slot_, cell_: cell_, refusal_: refusal_, expired_: expired_,
  YEARS: YEARS, FACULTIES: FACULTIES, RESIDENCE: RESIDENCE, ORG: ORG, FREE: FREE, KEEP_DAYS: KEEP_DAYS };
