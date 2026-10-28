# VSUrvey: notes for Claude

This repository is the Project CAMPUS student survey (D-037), kept apart from the master document so respondents don't read the proposal before answering (D-039). Its decisions are rows in the master document's register, `content/13-decisions.md` in [projectcampus-docs](https://github.com/Ywcxz/projectcampus-docs), and its protocol is in Chapter 8 there. A decision counts only once it is a row in that register.

## Never

- Commit survey responses, contact details, or interview notes (D-086).
- Set `OPEN` to `true`, in `index.html` or `volunteer.html`. The owner opens the survey and the interview sign-up once VSU's permission is in hand (D-083).
- Let the survey and the sign-up share a receiver, a sheet, or anything that would tie a sign-up to a survey answer (D-039).
- Load the 3D moments (`js/`) anywhere but the first and last screens, or where D-166 says not to: with reduced motion or data saver on, on a phone without a fast connection, or without a graphics card.

## Before you push

```bash
cd tests && npm install && npm test
```

- Changed a page's script? Run `node scripts/csp.js` and commit `vercel.json` with it. The security policy names each script by its hash, and the tests fail until they match.
- Changed `js/scene3d.js`? Bump its `?v=` key in `index.html`.
- Work on a branch and open a pull request; the owner merges.
- Name your branch `claude/` plus a short topic, such as `claude/coins-wording`. ChatGPT's branches start with `chatgpt/`, so each pull request shows who made it (D-131).
