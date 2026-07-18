# reflex, 90-second demo script

**Format**: science fair, at your station. One laptop, two windows, cost counter on each.
**Rule**: start the demo immediately. Speak while demoing. Never explain before showing.

**Pre-demo setup (do this before a judge walks up):**
- Left window: screenshot agent already running, already polling, counter already ticking. It should have visible burn on the clock when they arrive.
- Right window: Reflex agent already subscribed and idling at ~$0.00.
- Teammate on standby with the DM ready to send. Rehearse the hand signal.

---

## The script

**0:00 to 0:12 — hook, while pointing at the left window**

> "This agent is watching a LinkedIn inbox for a new message. To do that, it screenshots the page every 60 seconds and runs a vision model on it. It's been doing that for four minutes. It has burned [X] tokens and it still doesn't know anything happened."

**0:12 to 0:30 — the contrast, point right**

> "This one is doing the exact same job. It's subscribed to the page and it's idle. Zero screenshots. Zero tokens while nothing is happening. It's waiting on an actual event, not a timer."

**0:30 to 0:45 — the moment (signal your teammate NOW)**

> "Watch."

*[teammate sends the DM live]*

> "That fired in under a second. And look at what it got: the sender's name, the thread, the text, already resolved. It didn't read a screenshot. The page told it."

**0:45 to 1:05 — the number, point at both counters**

> "Same task. [X] tokens versus [Y]. [X] dollars versus [Y]. Sixty seconds of lag versus one. The reason is that we gave the agent a modality it doesn't normally have: the network and event layer the browser is already emitting. Everyone builds agents that look at pages. Almost nobody listens to them."

**1:05 to 1:20 — generalize, then the proactive turn**

> "This isn't a LinkedIn DM reader. It's a listener you can point at anything that runs JavaScript. Same primitive watches a payment clear, an invoice flip to paid, a chargeback post. And because we're already recording the real traffic, we can go the other way too: it sees the workflows you repeat across tabs and tells you which ones are worth automating."

**1:20 to 1:30 — close**

> "Reactive agents are free until something actually matters. That's the whole idea."

---

## The 20-second version (for hallway, or if a judge is rushing)

> "Browser agents poll. To watch your inbox, they screenshot the page every minute and run a vision model on it, so they're slow AND expensive. We gave agents an event layer instead: they subscribe to a page and get pinged the instant something happens, with the sender and content already resolved. Sub-second instead of 60, and near-zero cost while idle. It works on anything that runs JavaScript."

---

## Numbers to have on screen (fill these in before demos start)

| Metric | Screenshot agent | Reflex | Note |
|---|---|---|---|
| Tokens | | | live counter |
| Cost | | | live counter |
| Latency to detect | up to 60s | < 1s | the headline |
| Raw events inspected | n/a | 3054 → ~125 → handful | real number from the perception funnel |

Put the funnel number on screen somewhere. `3054 raw → 125 useful → the handful that matter` is concrete, it's real, and it proves the efficiency claim isn't hand-waving.

---

## Judge questions, and the honest answers

**"Doesn't MCP require the agent to call a tool? How is that push?"**
> "Correct, and we're not pretending otherwise. Reactivity here is a long-lived tool call that blocks and resolves the moment a real event arrives. The agent isn't looping, it isn't burning tokens, and it isn't on a timer. That's the primitive."

**"Is this just hardcoded for LinkedIn?"**
> "The extractor is per-site, the rest isn't. Capture, redaction, intent-narrowing, and the event contract are generic. Adding a site is one extractor file. We picked one site and did it properly rather than four badly."

**"What about auth and antibot?"**
> "We ride your already-authenticated session in your own browser. There's no scraping, no headless login, nothing to detect. That's a side benefit of doing it as an extension."

**"Is this a privacy nightmare?"**
> "It's built the other way around. Cookies, auth headers, and CSRF tokens are dropped at the capture layer and never stored. Tokens, keys, and emails are recursively redacted. No typed input values, no full DOM snapshots. Everything is local, and the daemon only ever receives already-redacted events."

**"What's the business case?"**
> "Any agent that has to wait on a state change today is either slow or expensive, and usually both. Payment cleared, invoice paid, ticket escalated, candidate replied. We make that class of agent cheap enough to leave running."

---

## Cut list, if you're over time

Cut in this order:
1. The proactive workflow-extraction sentence (1:05 to 1:20). Keep it only if the demo went fast.
2. The generalization list. Keep one example, not three.
3. The funnel number, if the counters are already convincing.

Never cut: the live event firing. That is the demo.
