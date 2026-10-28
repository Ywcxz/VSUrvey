# VSUrvey

VSUrvey (formerly Istorya sa VSU): the Project CAMPUS student survey about student life and VSU's services, an interactive page of drawn scenes ([D-037](https://docs.projectcampus.org/decisions.html#d-037)). Version `since-v1` asks about each problem in the respondent's time at VSU, which the first screen names once, with all that have happened picked, in place of how often and how serious ([D-132](https://docs.projectcampus.org/decisions.html#d-132), revising [D-038](https://docs.projectcampus.org/decisions.html#d-038)). It is one walk in the order of `scenes-v3`, and long by choice: the first screen says it takes 20 to 25 minutes, and any question can be skipped ([D-133](https://docs.projectcampus.org/decisions.html#d-133)).

- `index.html` is the whole survey: one page, in the look of the landing page and the master document, with its fonts in `fonts/`.
- `fonts/` holds Newsreader (the questions) and Atkinson Hyperlegible (everything else), Latin only, with their licences, so the pages load nothing from another site.
- `js/` holds the survey's two 3D moments, a ring of coins around the title on the first screen and confetti on the last (`scene3d.js`), and three.js r169, which draws them (`three.module.min.js`, unchanged from its release, under its own licence in `LICENSE-three.txt`). The page fetches them only after the first screen shows, and only on a computer, or on a fast connection without data saver, with motion on and a graphics card; on a screen too short for the ring, the drawn ring stays and they wait for the last screen. Everyone else keeps the drawn versions, which are complete on their own ([D-166](https://docs.projectcampus.org/decisions.html#d-166)). After changing `scene3d.js`, bump its `?v=` key in `index.html`.
- `vercel.json` serves the pages under a strict security policy: only their own scripts run, the inline ones named by hash and the files in `js/`, and answers can go only to the Apps Script receivers. After changing either page's script, run `node scripts/csp.js` and commit `vercel.json` with it; the tests serve the pages under that policy and fail until the two agree.
- `survey-receiver.gs` is the Apps Script that writes each answer to a private Google Sheet. Its first lines say how to set it up or update it.
- `volunteer.html` is the interview sign-up, in the survey's look, linked from the survey's last screen. It is its own page, so it can be shared on its own too.
- `volunteer-receiver.gs` is the sign-up's own Apps Script, in its own private Google Sheet, apart from the survey's, so contact details never meet survey answers ([D-039](https://docs.projectcampus.org/decisions.html#d-039), [D-143](https://docs.projectcampus.org/decisions.html#d-143)). It deletes each sign-up once the interview is ticked as done, or three months after signing up ([D-111](https://docs.projectcampus.org/decisions.html#d-111)). It replaces the Google Form the survey's script used to build.
- `tests/` walks the survey and the sign-up in a headless browser with made-up answers and checks what they would send: `cd tests && npm install && npm test`. `npm run test:volunteer` runs only the sign-up's checks.
- `.github/workflows/` runs the tests ("Survey test") and the name guard ("Name guard", [D-030](https://docs.projectcampus.org/decisions.html#d-030)) on every pull request. The name guard reads the names from a repository secret, `PRIVATE_NAMES`, one per line; until it is set, it passes with a notice. `scripts/hooks/pre-commit` is the same guard for commits made on your own computer: `git config core.hooksPath scripts/hooks`.

## Before the survey opens

The page ships closed. Near the top of the script in `index.html`, `OPEN` is `false`, so even the live address sends nothing. Set it to `true` only once VSU's permission to run the survey is in hand ([D-083](https://docs.projectcampus.org/decisions.html#d-083)). `volunteer.html` has its own `OPEN`, also `false`, for the interviews; it also sends nothing until its `ENDPOINT` holds the sign-up receiver's address.

To check that answers reach the sheet before then, open the live address with `?test=1` added. That answer is marked as a test; delete it from the sheet afterward. The survey's last screen passes `?test=1` on to the sign-up, whose test rows delete themselves a day later.

### Going live, step by step

1. **Survey receiver.** In the survey's Apps Script, paste the current `survey-receiver.gs`, run `setup()`, then Deploy > Manage deployments > edit > Version: New version > Deploy. The URL in `ENDPOINT` stays the same.
2. **Sign-up receiver.** Make a new, separate Google Sheet, paste `volunteer-receiver.gs` into its Apps Script, run `setup()`, and deploy it as a web app (Execute as: Me; Who has access: Anyone). Its URL goes in `volunteer.html`'s `ENDPOINT` through a pull request.
3. **Retire the Google Form.** In the old interview-volunteer form, turn off "Accepting responses", and delete any responses it holds once those volunteers are contacted or three months have passed ([D-111](https://docs.projectcampus.org/decisions.html#d-111)).
4. **Test.** Open the live survey with `?test=1`, send, follow the sign-up link, and sign up. Check that one row reaches "Responses since" and one reaches "Sign-ups", in their separate sheets. Delete the survey's test row.
5. **Finish the checklist below**, including the pilot and the timed run-throughs.
6. **Open.** Once VSU's written permission is in hand, a pull request sets `OPEN = true` in `index.html`, and in `volunteer.html` if the permission covers the interviews.

The protocol the survey follows, and the problem each question bears on, are in Chapter 8 of the master document.

## Pre-launch checklist

Tick every item before `OPEN` becomes `true`. The checklist stays until the survey opens, then it records how it was opened. "Tests" means `npm test` checks it on every run; the rest are done by hand.

### Permission and protocol

- [ ] VSU's written permission to run the survey is in hand, and says whether it covers the interviews and the pilot ([D-083](https://docs.projectcampus.org/decisions.html#d-083)). Whether an ethics review is also needed is settled with OVPSAS and VSU's Research Ethics Board ([Q-51](https://docs.projectcampus.org/decisions.html#q-51)). (By hand)
- [ ] The owner has confirmed the protocol in Chapter 8, closing [Q-53](https://docs.projectcampus.org/decisions.html#q-53): which answers count as each problem, and how results are split by year ([D-132](https://docs.projectcampus.org/decisions.html#d-132)). All are fixed before any answer is read. [D-114](https://docs.projectcampus.org/decisions.html#d-114) (the site ships closed), which still awaits him, is confirmed. (By hand)
- [ ] The rules for releasing results (the floor of 10, combinations, free text) are published in Chapter 8. (By hand)

### The survey page

- [ ] The first screen says who runs the survey, that it is independent and not an official VSU survey, that answers carry no name, and how they are kept. The gate's first line says any question can be skipped. (By hand; the gate line is in the tests)
- [ ] On phones from 360 × 640, every screen keeps its drawing in view, and answers that don't fit can be scrolled to above the bottom bar; on computers, every answer is in view without scrolling. (Tests)
- [ ] Every skip rule works: which part of campus only for a VSU dorm, and the barangay and getting to campus only for those who live off campus; one's own vehicle or a ride to campus offered only to those who have one; a program only from the faculty picked, and none asked for a faculty with one; kinds of orgs only for members, and one org follow-up for each level of involvement; skipping the networks skips every question on load and data, and mobile data under getting online; two networks; the promo questions (whether the data lasts, buying another promo, and why); Wi-Fi spending only after Wi-Fi where they reside; checking a post, whether answers were right, the new office, what made reaching someone hard, keeping a concern to yourself or hearing back on one; finding a place, scams. A follow-up goes when the answer that brought it changes, and "It hasn't happened" answers stand alone. Follow-ups carry a tag. (Tests)
- [ ] A respondent can go back and change an answer, and the parts menu shows progress. (Tests)
- [ ] With reduced motion on, nothing moves on by itself and the walk still works. (Tests)
- [ ] The 3D moments load only on a computer, or on a fast connection, with motion on and a graphics card, never with data saver; without them, the drawn versions stay ([D-166](https://docs.projectcampus.org/decisions.html#d-166)). (Tests)
- [ ] Nothing is sent while `OPEN` is `false`, except answers marked as tests; previews never send. The Send screen sends one record. (Tests)

### Wording and lists, checked against VSU and the field

- [ ] A pilot of at least 5 students, within the permission, checks the wording, auto-advance (did anyone feel rushed, or move on by accident?), the since-you-started questions (do students read "pick all that have happened" as covering their whole time at VSU, without the period in each question?), the "More below" sign on phones, the length (where did anyone stop, or start skipping?), and the interview sign-up. (By hand)
- [ ] The first screen's time estimate comes from the median and 90th percentile of at least 10 timed run-throughs, or is labeled preliminary. The current "20–25 minutes" is a preliminary estimate from the page's own text and answer counts (re-estimated on 23 October 2026: about 23 minutes on a typical path at a typical reading speed, 15 to 28 across reading speeds and paths), not a timing. (By hand)
- [ ] The program lists are checked with VSU's registrar, since VSU's admissions page leaves out at least BS Mathematics ([E-057](https://docs.projectcampus.org/evidence.html#e-057)). (By hand)
- [ ] The barangay groups are checked against where students actually reside: whether any group is too small to report ([D-110](https://docs.projectcampus.org/decisions.html#d-110)), and whether "Guadalupe (Utod)" is the name students use. Lower and upper campus are checked against where VSU's dorms are. (By hand)
- [ ] The office types in "What kind of office was it?" are checked against VSU's own offices, so each office a student might mean has a clear answer. (By hand)
- [ ] The load bands' middles (about ₱50, ₱100, ₱150 a week) and the uses in "What do you use your mobile data for?" are re-checked against the networks' current promos ([D-139](https://docs.projectcampus.org/decisions.html#d-139)). (By hand)
- [ ] The jars' three concerns from the student council federation's list (VSU's online services, basic facilities, grading and academic rules) are checked against the council's own published list. (By hand)

### Where answers and sign-ups go

- [ ] The survey's receiver is deployed and tested against `since-v1`, with a `?test=1` answer reaching the "Responses since" tab. (By hand)
- [ ] The sign-up's receiver is deployed in its own sheet, its address is in `volunteer.html`'s `ENDPOINT`, its daily clean-up is installed (`setup()`), and a `?test=1` sign-up reaches "Sign-ups". The old Google Form no longer accepts responses. (By hand)
- [ ] The live site sends its security headers (`curl -sI https://survey.projectcampus.org/student-life | grep -i content-security`), and the `?test=1` answer and sign-up above reached their sheets under them. (By hand; the tests serve the pages under the same policy)
- [ ] Interview sign-ups go to the sign-up's own sheet, never into the survey sheet, and nothing in a sign-up ties it to a survey answer. (Tests; the two separate sheets by hand)
- [ ] Test answers are marked and are deleted from the survey sheet before analysis. (By hand)
- [ ] Comments are never quoted, and a comment that shows its writer is under 18 removes the whole record. (By hand)

### The interviews

- [ ] The interview guide covers what the survey left out: trust in each channel ([Q-64](https://docs.projectcampus.org/decisions.html#q-64)), and organization handovers ([P-08](https://docs.projectcampus.org/evidence.html#p-08)). The survey asks how a post was checked; the interviews ask why. (By hand)

## Licence

Code is under the [MIT License](LICENSE). Writing and pictures are under [CC BY 4.0](LICENSE-CONTENT.md), which says which files are which. Copyright © 2026 Leo M. Subingsubing ([D-159](https://docs.projectcampus.org/decisions.html#d-159)).
