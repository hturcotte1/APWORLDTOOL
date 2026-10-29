# How to edit the game content

All of the game's history content lives in plain data files, separate from the game code:

| File | What's in it |
|---|---|
| `content/empires/<empire>.json` | One file per empire: intro, decisions, options, points, explanations, the end-screen timeline, and key-term definitions |
| `content/glossary.json` | Key terms shared by several empires (Sunni, Shia, jizya, …) |
| `content/rules.json` | Tier rules: point ranges, starting stability, collapse penalty, path-length limits |

## The easy way: ask Claude

Open a Claude Code session on this repository and describe the change in plain words, for example:

> "In the Ottoman empire, change the explanation for the Lepanto rebuild option to mention the Venetian peace of 1573 more clearly, then run the checks and redeploy."

Claude will edit the file, run the validation, balance, and test scripts, update the Content Review document, and redeploy. To redeploy, the session needs the `CLOUDFLARE_API_TOKEN` environment variable described in `docs/DEPLOYMENT.md`.

## Editing by hand on GitHub

1. Open the repository on GitHub, then open `content/empires/` and the empire's file.
2. Click the **pencil** icon to edit.
3. Change only the text **inside the quotation marks**. Keep every quote mark, comma, colon, and bracket exactly where it is. If your text needs a quotation mark, type it as `\"`.
4. Click **Commit changes**.
5. The live site doesn't change until it is **redeployed** (ask Claude, or run `npm run deploy`, see `docs/DEPLOYMENT.md`).

## What the fields mean

```jsonc
"istanbul": {                          // decision id (used by "next" links)
  "year": 1454,                        // year shown on the timeline bar
  "title": "A City of Many Faiths",
  "milestone": true,                   // optional: a turning point every player must reach
  "text": "Constantinople is yours…",  // the situation, about 60–100 words
  "context": [                         // optional extra lines that depend on earlier choices
    { "if": "millet", "text": "…" }
  ],
  "options": [                         // exactly 3 must be visible at any moment
    {
      "id": "a",
      "text": "Let each religious community…",  // the choice the student clicks
      "points": 6,                              // must fit the tier's range in rules.json
      "stability": -1,                          // optional: -2, -1, or +1
      "set": ["millet"],                        // optional: flags remembered for later
      "if": "cannons", "ifNot": "harsh",        // optional: only show this option when…
      "next": "chaldiran",                      // the next decision id, or "end"
      "collapse": { "year": 1702, "text": "…" },// optional INSTEAD of "next": the empire falls
      "explanation": "Excellent. Mehmed named…"  // 2–3 sentences: your choice vs. real history
    }
  ]
}
```

Key terms: add `{ "term": "devshirme", "def": "…" }` to an empire's `glossary` list, or to `content/glossary.json` for terms several empires share. The game adds the definition in parentheses the **first** time the term appears in a play-through. The optional `"match"` list adds other spellings (for example, plurals).

## Checks that must pass after any edit

Run `npm run check`. This runs:

- **`npm run validate`**: no dead ends or broken links, every path reaches an ending, full paths are 7–9 decisions, exactly 3 options show at every decision, the best option is never tied, points match the tier rules, explanations are at most 3 sentences, and every flag that's checked is also set somewhere.
- **`npm run balance`**: plays every possible path and checks the scoring goals (strong Hard players beat strong Easy players, careless Hard players can sink lowest, collapses land in the lower part of the leaderboard, Hard collapses more than Medium, and Medium more than Easy). It writes `docs/BALANCE_REPORT.md`.
- **`npm test`**: unit and API tests.

Then run `npm run review-doc` to refresh `docs/CONTENT_REVIEW.md`, and `npm run format-content` to tidy the JSON formatting.
If you change points, `npm run balance` tells you if the tuning goals still hold.
