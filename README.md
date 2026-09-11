# Score It

A scorekeeper for 1–12 players that works the way a scorekeeper should: press a
player's dot and swipe around the ring. No accounts, no network, no build step —
one static page you can host on GitHub Pages.

<img src="icon.svg" width="88" alt="">

## How it works

| Gesture | Result |
| --- | --- |
| **Press a dot and swipe around the ring** | Dials that player's score up (clockwise) or down (counter-clockwise). The running total shows in the middle and lands when you lift your finger. |
| **Tap a dot** | Adds one step |
| **Tap a name or score** | Rotates it 90° — so scores face whoever is sitting on that side of the table |
| **⚙︎ (top right)** | Add or remove players, rename them, pick any color, set the score step and sensitivity, reset scores |
| **☰ (top left)** | Score history with undo and redo |

**Score step** sets how much each stop on the ring is worth — 1, 5, 10, 25 or 50 — so a
game scored in 25s takes the same flick as one scored in 1s. **Sensitivity** is a
separate thing: how many stops there are in a full turn of the ring (6–24), which
is how far your thumb travels per point.

One swipe is one entry in the history, so undo takes back the whole move rather
than unwinding it a point at a time. Everything is stored in `localStorage` on
the device — the game is still there when you come back.

## Run it locally

It is plain HTML, CSS and JavaScript; no install, no dependencies.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Put it on GitHub Pages

```sh
git init
git add .
git commit -m "Score It"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Then in the repository: **Settings → Pages → Source: Deploy from a branch →
`main` / `/ (root)`**. It publishes at `https://<you>.github.io/<repo>/` within a
minute or two.

Every path in the project is relative, so it works from a repository subpath as
well as a custom domain. The empty `.nojekyll` file tells Pages to serve the
files as-is.

On a phone, use **Share → Add to Home Screen** — it launches full screen with no
browser chrome.

## Files

```
index.html      markup and the inline SVG ring
styles.css      the whole theme; sizes come from CSS custom properties
app.js          state, the swipe engine, rendering, persistence
tools/          regenerates the PNG icons (node tools/make-icons.mjs)
```

Two details worth knowing if you edit `app.js`:

- Swipes accumulate the **shortest arc** between pointer samples
  (`((d + 540) % 360) - 180`). Diffing raw angles instead would make the score
  jump by a full revolution as the finger crosses the 180° mark.
- Scores and the history log are separate from the live swipe. Nothing is
  committed until you lift your finger, which is what makes undo work per move.
