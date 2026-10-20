# VSUrvey

VSUrvey (formerly Istorya sa VSU): the Project CAMPUS student survey about student life and VSU's services, in the scenes format (D-037).

- `index.html` is the whole survey: one self-contained page.
- `survey-receiver.gs` is the Apps Script that writes each answer to a private Google Sheet and keeps the separate interview-volunteer form up to date. Its first lines say how to set it up or update it.
- `tests/` walks the survey in a headless browser with made-up answers and checks what it would send: `cd tests && npm install && npm test`.

## Before the survey opens

The page ships closed. Near the top of the script in `index.html`, `OPEN` is `false`, so even the live address sends nothing. Set it to `true` only once VSU's permission to run the survey is in hand (D-083).

To check that answers reach the sheet before then, open the live address with `?test=1` added. That answer is marked as a test; delete it from the sheet afterward.

The protocol the survey follows, and the problem each question bears on, are in Chapter 8 of the master document.

## Pre-launch checklist

Tick every item before `OPEN` becomes `true`. "Tests" means `npm test` checks it on every run; the rest are done by hand.

- [ ] The first screen says who runs the survey, that it is independent and not an official VSU survey, that answers carry no name, and how they are kept. The gate's first line says Your form can't be skipped. (By hand; the gate line is in the tests)
- [ ] The owner has confirmed the protocol in Chapter 8, closing Q-53, and settled Q-65 (whether D-038's 30% bar fits the semester window). Both are fixed before any answer is read. (By hand)
- [ ] Every answer is in view without scrolling at 360 × 640 and the other sizes tested, with the news channels in any order. (Tests)
- [ ] Every skip rule works: no SIM, no load, calls and texts only, app data, Wi-Fi spending, reaching someone, the housing default. (Tests)
- [ ] A respondent can go back and change an answer, and the parts menu shows progress. (Tests)
- [ ] Your form can't be skipped, and each of its questions offers Prefer not to say. (Tests)
- [ ] Nothing is sent while `OPEN` is `false`, except answers marked as tests; previews never send. (Tests)
- [ ] Test answers are marked and are deleted from the sheet before analysis. (By hand)
- [ ] Interview sign-ups go to the separate form, never into the survey sheet. (By hand)
- [ ] Stories are quoted only where the writer ticked the box, and only after names and identifying details are removed. (By hand)
- [ ] With reduced motion on, nothing moves on by itself and the walk still works. (Tests)
- [ ] A pilot of at least 5 students checks the wording, auto-advance (did anyone feel rushed, or move on by accident?), and the housing default (did commuters read it as picked for them?). (By hand)
- [ ] The first screen's time estimate comes from the median and 90th percentile of at least 10 timed run-throughs, or is labeled preliminary. (By hand)
- [ ] The Apps Script receiver is deployed and tested against `scenes-v3`, with a `?test=1` answer reaching the "Responses v3" tab. (By hand)
- [ ] The rules for releasing results (the floor of 10, combinations, free text) are published in Chapter 8. (By hand)
- [ ] The interview guide covers what the survey left out: trust in each channel and checking a post against an official source (Q-64), and organization handovers (P-08). (By hand)
