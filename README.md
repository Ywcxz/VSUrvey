# VSUrvey

VSUrvey (formerly Istorya sa VSU): the Project CAMPUS student survey about student life and VSU's services, an interactive page of drawn scenes (D-037). Version `last-time-v1` asks about each problem as the last time it came up, with what it cost, in place of how often and how serious (D-038, as proposed for revision on 22 October 2026). A core of about 15 minutes comes first; after it, respondents choose to send or to go on to an optional part of about 7 minutes.

- `index.html` is the whole survey: one self-contained page.
- `survey-receiver.gs` is the Apps Script that writes each answer to a private Google Sheet and keeps the separate interview-volunteer form up to date. Its first lines say how to set it up or update it.
- `tests/` walks the survey in a headless browser with made-up answers and checks what it would send: `cd tests && npm install && npm test`.

## Before the survey opens

The page ships closed. Near the top of the script in `index.html`, `OPEN` is `false`, so even the live address sends nothing. Set it to `true` only once VSU's permission to run the survey is in hand (D-083).

To check that answers reach the sheet before then, open the live address with `?test=1` added. That answer is marked as a test; delete it from the sheet afterward.

The protocol the survey follows, and the problem each question bears on, are in Chapter 8 of the master document.

## Pre-launch checklist

Tick every item before `OPEN` becomes `true`. "Tests" means `npm test` checks it on every run; the rest are done by hand.

- [ ] The first screen says who runs the survey, that it is independent and not an official VSU survey, that answers carry no name, and how they are kept. The gate's first line says any question can be skipped. (By hand; the gate line is in the tests)
- [ ] The owner has confirmed the protocol in Chapter 8, closing Q-53, including D-038's revision: which answers count as each problem, the cost bar, and how a full answer replaces its core (the latest record for each record ID counts). All are fixed before any answer is read. (By hand)
- [ ] On phones from 360 × 640, every screen keeps its drawing in view, and answers that don't fit can be scrolled to above the bottom bar; on computers, every answer is in view without scrolling. (Tests)
- [ ] Every skip rule works: the optional part only after "Tell us more"; two networks, no load, calls and texts only, app data, the promo questions (no promo, data that lasts, not reloading), Wi-Fi spending; checking a post, whether an answer was right, the new office, reaching someone, keeping a concern to yourself or hearing back on one; finding a place, scams; and every what-it-cost question, which follows only an answer that names the problem and goes when that answer changes. Follow-ups carry a tag. (Tests)
- [ ] A respondent can go back and change an answer, and the parts menu shows progress. (Tests)
- [ ] Nothing is sent while `OPEN` is `false`, except answers marked as tests; previews never send. Going on to the optional part sends the core first; the Send screen sends the whole, under the same record ID. (Tests)
- [ ] Test answers are marked and are deleted from the sheet before analysis. (By hand)
- [ ] Interview sign-ups go to the separate form, never into the survey sheet. (By hand)
- [ ] Comments are never quoted, and a comment that shows its writer is under 18 removes the whole record. (By hand)
- [ ] With reduced motion on, nothing moves on by itself and the walk still works. (Tests)
- [ ] A pilot of at least 5 students checks the wording, auto-advance (did anyone feel rushed, or move on by accident?), the what-it-cost questions (do the costs fit each problem?), the "More below" sign on phones, and the choice after the core (did anyone think "Send now" ended too early?). (By hand)
- [ ] The first screen's time estimate comes from the median and 90th percentile of at least 10 timed run-throughs, or is labeled preliminary. The current "About 15 minutes, then an optional part" is a preliminary estimate from the page's own text and answer counts (the core about 15 minutes on a typical path, 13 to 18 across reading speeds; the optional part about 7 more), not a timing. (By hand)
- [ ] The load bands' middles (about ₱50, ₱100, ₱150 a week) and the apps list are re-checked against the networks' current promos. (By hand)
- [ ] The office types in "What kind of office was it?" are checked against VSU's own offices, so each office a student might mean has a clear answer. (By hand)
- [ ] The Apps Script receiver is deployed and tested against `last-time-v1`, with a `?test=1` answer reaching the "Responses last-time" tab, once for "Send now" and once for "Tell us more". (By hand)
- [ ] The rules for releasing results (the floor of 10, combinations, free text) are published in Chapter 8. (By hand)
- [ ] The interview guide covers what the survey left out: trust in each channel (Q-64), and organization handovers (P-08). The survey asks how a post was checked; the interviews ask why. (By hand)
- [ ] The jars' three concerns from the student council federation's list (VSU's online services, basic facilities, grading and academic rules) are checked against the council's own published list. (By hand)
