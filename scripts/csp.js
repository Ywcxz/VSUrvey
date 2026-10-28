#!/usr/bin/env node
/*
 * Writes the security policy into vercel.json. Each page runs one inline script, and the policy allows exactly those
 * scripts by their SHA-256 hashes, so editing either script changes its hash: run this after any edit to a page's script
 * and commit vercel.json with the page. The tests fail until the two agree, so a stale policy can't block the live survey.
 *
 *   node scripts/csp.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PAGES = ["index.html", "volunteer.html"];
const VERCEL = path.join(ROOT, "vercel.json");

/* The hash of each inline script in a page's HTML, as the policy names it. */
function hashes(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => "'sha256-" + crypto.createHash("sha256").update(m[1], "utf8").digest("base64") + "'");
}

function policy() {
  return [
    "default-src 'none'",
    // The pages' own inline scripts, by hash, and the site's own files (the 3D moments in js/, D-166).
    "script-src 'self' " + PAGES.flatMap(f => hashes(fs.readFileSync(path.join(ROOT, f), "utf8"))).join(" "),
    // The drawings set a few inline styles (positions, delays, colors); styles can't run code.
    "style-src 'self' 'unsafe-inline'",
    // The ticks on chosen answers are small inline SVG pictures.
    "img-src 'self' data:",
    "font-src 'self'",
    // Answers and sign-ups go only to their Apps Script receivers, which reply from googleusercontent.com.
    "connect-src https://script.google.com https://script.googleusercontent.com",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function current() {
  const v = JSON.parse(fs.readFileSync(VERCEL, "utf8"));
  const all = (v.headers || []).find(h => h.source === "/(.*)");
  const csp = all && all.headers.find(h => h.key === "Content-Security-Policy");
  return csp ? csp.value : null;
}

module.exports = { policy, current, hashes };

if (require.main === module) {
  const text = fs.readFileSync(VERCEL, "utf8");
  const next = text.replace(/("key": "Content-Security-Policy", "value": ")[^"]*(")/, (m, a, b) => a + policy() + b);
  if (next === text && current() !== policy()) throw new Error("vercel.json has no Content-Security-Policy header to update");
  fs.writeFileSync(VERCEL, next);
  console.log(current() === policy() ? "vercel.json: security policy is current" : "vercel.json: could not update the policy");
}
