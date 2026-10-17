# istorya-sa-vsu

VSUrvey (formerly Istorya sa VSU): the Project CAMPUS student survey about student life and VSU's services, in the scenes format (D-037).

- `index.html` is the whole survey: one self-contained page.
- `survey-receiver.gs` is the Apps Script that writes each answer to a private Google Sheet and keeps the separate interview-volunteer form up to date. Its first lines say how to set it up or update it.
- `tests/` walks the survey in a headless browser with made-up answers and checks what it would send: `cd tests && npm install && npm test`.

## Before the survey opens

The page ships closed. Near the top of the script in `index.html`, `OPEN` is `false`, so even the live address sends nothing. Set it to `true` only once VSU's permission to run the survey is in hand (D-083).

To check that answers reach the sheet before then, open the live address with `?test=1` added. That answer is marked as a test; delete it from the sheet afterward.

The protocol the survey follows, and the problem each question bears on, are in Chapter 8 of the master document.
