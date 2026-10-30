# Teacher Guide: Rule the Empire

A 15–20 minute review game for **AP World History Unit 3: Land-Based Empires (1450–1750)**.
Each student rules one of eight empires through about 8 historical decisions, sees what really happened after every choice, and lands on a shared class leaderboard.

## Your links

| What | Link |
|---|---|
| **Game (share with students)** | https://rule-the-empire.rule-empire-0ee0f1.workers.dev |
| Leaderboard (good for a projector) | https://rule-the-empire.rule-empire-0ee0f1.workers.dev/#leaderboard |
| Teacher controls | Click **Teacher** at the bottom of any page, or go to https://rule-the-empire.rule-empire-0ee0f1.workers.dev/#teacher |

No student accounts or logins are needed. It works on Chromebooks, laptops, tablets, and phones.

## How students play

1. **Open the link** and type their **first name**, then pick their **class period** (1, 2, or 3).
   If two students in the same period share a first name, one of them should add a last initial (for example, "Maya R").
2. **Pick an empire.** Several students can choose the same one. Empires are grouped by difficulty:
   - **Easy** (Mughal, Ming & Qing China, Tokugawa Japan): 0 to +5 points per decision, 4 stability shields.
   - **Medium** (Ottoman, Russian): −1 to +6 points per decision, 3 shields.
   - **Hard** (Spanish, Safavid, Songhai): −3 to +8 points per decision, only 2 shields, and some choices can end the game on the spot.
3. **Make about 8 decisions.** Each decision has 3 options, shuffled differently for every student. Key terms (like *devshirme* or *sakoku*) are defined in parentheses the first time they appear.
4. **After each choice** they see the points earned, any lost stability, and a short "What actually happened" explanation.
5. **Turning points** (4–5 per empire, the ones every student reaches) are followed by a **map scene**: a few seconds of animation showing what really happened, such as Columbus's route across the Atlantic, Ottoman cannons at Constantinople, or Russia's push down the Volga. Students can replay it or skip ahead with **Next decision**.
6. **Stability:** poor choices can cost a shield. If the shields run out, or the student makes a disastrous choice, the empire **collapses early**: its seal cracks and the map goes dark. A collapse costs half of the student's points (at least 10), so collapsed empires land near the bottom of the leaderboard.
7. **The end screen** shows the final score, a recap of every choice (with the best option for each decision), and a short timeline of what really happened to that empire. Students who collapse early still see the whole real story.

**Only the first game counts.** A student's first finished game (matched by first name + period, ignoring capital letters and extra spaces) goes on the leaderboard. Every game after that is clearly labeled **"Practice run – doesn't count for the leaderboard"** and is never saved. Encourage students to replay with other empires for review.

**If the bell rings mid-game:** progress is saved on that device. When the student reopens the link on the same device, their game appears under **Unfinished reigns** on the start screen with a **Resume** button. Until they finish, their name shows under **Reigns in progress** on the leaderboard.

## Reading the leaderboard

- **Class standings** at the top show each period's **average score** (finished first games only), and the leading period gets a **Leads** tag. It's a friendly class-vs-class competition, and it's always shown, whichever tab is open.
- Tabs switch between **Period 1**, **Period 2**, **Period 3**, and **All Classes**.
- Columns: **Rank**, **Name**, **Empire**, **Tier** (I Easy / II Medium / III Hard), **Score**, and **Result** (Survived or Collapsed). The All Classes view also shows the period. On phones, the tier appears under each empire's seal and the period column is hidden to save space.
- The top three ranks get a gold crown.
- Students with the same score share a rank.
- It **updates automatically** every 10 seconds, so you can leave it up on a projector.
- **What scores mean:** strong play scores about 35–40 on an Easy empire, about 40–48 on a Medium one, and about 50–64 on a Hard one. Collapses usually score near zero or below. Hard empires have the highest ceiling and the biggest risk. That's intentional, and it makes a good discussion point about why some empires were harder to rule.
- A good debrief question: *"Which empires collapsed most often in our class, and what real historical pressures did those choices represent?"*

## Teacher controls

1. Click **Teacher** in the small footer at the bottom of any page.
2. Type the teacher password and click **Unlock**. The **Class Report** opens (see below).
3. To manage scores, click **Manage the leaderboard**. The leaderboard opens in teacher mode, where you can:
   - **Delete a single entry:** click **✕ Delete** next to it (just **✕** on a phone). Use this for joke names, or to let a student replay for an official score (for example, if their first game was interrupted on a device they can't get back to).
   - **Clear one period's leaderboard:** pick that period's tab, then click **Clear Period N leaderboard**.
   - **Clear all leaderboards:** for example, at the start of a new school year. You'll be asked to confirm twice.
   - Abandoned games appear under **Reigns in progress**. Click the **✕** next to a name to remove it, so the student can start over officially.
4. Click **Class report** to go back to the report, or **Exit teacher mode** when you're done. The password is only remembered while that browser tab is open.

Deleting and clearing can't be undone.

## The Class Report

The report opens when you unlock teacher mode. Students never see it. Use the tabs to look at **Period 1**, **Period 2**, **Period 3**, or **All Classes**. It updates on its own every 30 seconds.

- **At a glance:** finished games, students still playing, average score, the share of empires that survived, and the top score.
- **Most-missed decisions:** the decisions the fewest students got right, listed first. For each one you see what share of students chose the best option, how the class split across all three options (with the **Best** answer marked, and a **Most picked** tag when one wrong answer was the class favorite), and the points for each. These are the best topics to review in class. Click **Show all** to see every decision students have answered. Decisions with only one or two answers so far are marked, so a single student doesn't skew your picture.
- **Period against period:** average score, number of games, and survival rate for each period, side by side.
- **Empires chosen:** how many students picked each empire, their average score, and how many survived.

The report uses students' **first games only**. Practice runs aren't saved, so they aren't counted. Answers from unfinished games count toward "most-missed decisions" but not toward averages. No names appear in the report.

## Changing the teacher password

The password is stored on the server (in Cloudflare), never in the web page, so students can't find it by inspecting the site.

1. Go to **https://dash.cloudflare.com** and log in.
2. In the left menu, click **Compute (Workers)** → **Workers & Pages**. (On some screens it's just called **Workers & Pages**.)
3. Click **rule-the-empire**.
4. Click the **Settings** tab.
5. Find **Variables and Secrets**. Next to **TEACHER_PASSWORD**, click the **pencil (Edit)** icon.
6. Type your new password and click **Deploy** (or **Save**).
7. Wait about a minute, then use the new password with the **Teacher** link.

Tips: use something long that students won't guess, like four random words with dashes. Don't use your school email password. The labels in the Cloudflare dashboard occasionally change, but the password is always under the Worker's **Settings → Variables and Secrets**.

## Privacy

The leaderboard stores only each student's **first name, period, empire, score, and whether they survived or collapsed**. To make resuming and score-checking work, it also keeps a random game code and the list of choices for that one game. It does **not** store last names, emails, accounts, or IP addresses. The browser remembers an unfinished game only so the student can continue it on the same device. Scores are never kept in the browser.

## Fair play

- Points are hidden until after a student chooses, answer order is shuffled for every student, and the **server** calculates every score from the choices. Students can't fake a score from their browser.
- After choosing, a student can't go back and change an answer in their official game.
- A student *could* practice under a different name first (for example, "Maya2"). Watch for odd or duplicate names and delete them.
- **Keep the GitHub repository private.** The content files there include the point values for every option. To make it private: go to the repository on GitHub → **Settings** → scroll to the bottom (**Danger Zone**) → **Change visibility** → **Make private**. The live game keeps working either way.

## If something goes wrong

| Problem | Fix |
|---|---|
| "Couldn't reach the game server" | Usually school Wi-Fi or a web filter. Ask IT to allow the game's address (it ends in **workers.dev**). |
| A student sees "Practice run" before playing | Someone already used that name in that period. Check the leaderboard, delete the wrong entry if needed, or have the student add a last initial. |
| A student lost their game (different device, cleared browser) | Delete their "Reigns in progress" entry in teacher mode so they can start over officially. |
| Teacher password doesn't work | Check for typos, then reset it (see "Changing the teacher password"). |

## Content and accuracy

- **docs/CONTENT_REVIEW.md** lists every empire's decisions, options, points, and explanations in one readable document. **Facts flagged as uncertain or debated are at the top.** Please spot-check those first.
- **docs/EDITING_CONTENT.md** explains how to change the game's content later.

## Limits and cost

The game runs on Cloudflare's free plan (100,000 requests per day). One student's game uses about 20–30 requests, so even several classes playing at once use a tiny fraction. Nothing to pay and nothing goes to sleep between classes.
