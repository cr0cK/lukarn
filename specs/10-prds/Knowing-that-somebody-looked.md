---
type: prd
target-repos:
  - lukarn
---

# Knowing that somebody looked, without going to look

Follows [Sharing without an account](./Sharing-without-an-account.md), which
defines a shared link and describes none of this. That intent was accepted first
and is not changed by this one.

## Why this exists

The instance already knows who opened what. An administration screen answers "the
`mamie` key visited on three days this week, from a television", which is a
different question from the two people actually ask, and nobody opens it anyway.

The two that get asked are these. An hour after sending an album to somebody: did
that arrive. Three weeks later, idly: has anybody actually looked at it. Neither
moment is spent sitting in an administration screen, so an answer that waits to be
asked for answers neither one.

## Who it is for

The person who runs the instance and sends the albums. They want to know that what
they sent arrived, and to keep a rough sense of whether anybody comes back. This
has one reader by construction.

## What it changes

Two halves, and the first one holds the answer.

**The record, in administration.** For every shared link and for every album,
administration shows when it was first opened, when it was last opened and how
many times. For an album that is per access key rather than per person, because a
key may be shared by a household and there is nobody in particular behind it
(D38). This is where the answer lives, and it is there whether or not anybody
asked to be written to.

**The mail, when asked for.** Notification is switched on where a link is created,
and on an album for the people who open it with an account. It is off until
somebody turns it on, and there is no switch that turns it on everywhere at once.

Once on, it produces two kinds of message, and only one door gets both. A
**link's first opening** says so at once, which is the answer to "did it arrive"
and has a single answer per link. Everything else arrives in a **periodic
summary**: every later opening of a link, and every opening of an album by an
account, the first one included. A link is something you sent, so there is a
moment afterwards when the question exists. An album an account already had is
not, and announcing each household's first visit to each album would report
something that did not just happen. The summary's interval is set in
administration and is a week unless changed. Both messages go to the address the
instance already uses for its owner.

The mail relays the record rather than being it. Turning the switch off removes
the messages and not the history, and a message that fails to send loses a
convenience rather than an answer.

## Slices

- The record, readable in administration: first opened, last opened, how many
  times, for a shared link and for an album by access key.
- The switch, offered when a link is made and on an album, off by default.
- The message announcing a link's first opening.
- The periodic summary, and its interval as a setting.

## What was already settled

- **Mail leaves on a queue, outside the request that triggered it, and a failure
  is logged and abandoned with no retry** (D37). That is affordable here because
  the record does not depend on the message: an absent mail is never evidence that
  nobody looked.
- **Where no mail server is configured, nothing is sent** and the switch has
  nothing to do (D37). The same holds where the instance has no address for its
  owner (D260824l). Administration still answers in both cases.
- **The subject names the instance** (D65), and the message arrives in the
  language its recipient reads (D260812d).
- **What is recorded stops where it already stops.** Never at the photograph and
  never at an address (D260809h). It can be said that a link or an album was
  opened; it cannot be said which pictures were looked at, and nothing here moves
  that line.
- **A link's name is a label the administrator typed** (D260824b), so a row and a
  message about a link both say "Tata Sylvie" because that is what was written
  down.
- **The person whose visit is recorded is not told**, which was decided
  deliberately and is recorded with what it costs (D260824m).

## Decision Record

Three questions asked in one round, one contradiction raised against a rule in
force, and one correction volunteered at the gate. Seven struck as already
answered by the decision log.

| #   | Question                                                                                                       | Answer                                                                  | Implication                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | At what cadence is the owner told?                                                                             | A link's first opening at once, everything else in a summary            | Two questions at two speeds, and the urgent one belongs to links alone because a link is a send and an album is not; the interval is a setting, a week by default (D260824k) |
| 2   | To what address?                                                                                               | The instance's moderation address                                       | D38 made that the single destination for anything addressed to whoever runs the instance, and it stays single (D260824l)                                                     |
| 3   | Do albums opened by an account get this too?                                                                   | Yes, in this intent                                                     | Same need and same answer whichever door was used; the switch is per album there, per link here (D260824n)                                                                   |
| 4   | _Challenge:_ measurement was built not to be a tracker, and a notification is not passive. Is the person told? | No, it is silent                                                        | D260809h is narrowed: the boundary survives, the passive posture does not (D260824m)                                                                                         |
| 5   | An unsent message is lost with no retry. Does that matter?                                                     | No, because the record is in administration and the mail only relays it | The mail is extra visibility rather than the feature, which is what makes an optional switch coherent (D260824k)                                                             |

Answer 4 deviated from the recommendation, which was to announce it on the shared
page and accept the cost of saying so. The argument that carried the day is that
the sentence reads as an accusation exactly where the feature is most ordinary.
What was given up is written into D260824m rather than left to be discovered.

## Out of scope

- **Telling the person that their visit is recorded.** Decided against, on the
  record (D260824m).
- **Sending to anybody but the instance's owner.** No destination chosen per link,
  and nothing sent to the visitor.
- **Saying which photographs were looked at.** The line D260809h drew stays where
  it is.
- **A message per opening.** Rejected on attention rather than on cost: the folder
  those land in is where the one that mattered gets missed too.
- **An immediate message when an account opens an album.** Six keys across twenty
  albums is a hundred and twenty announcements spread over months, each one
  answering a question nobody had asked. Those visits sit in the summary and in
  the record.
- **One switch for the whole instance.** Whether mail goes out is a property of
  what was shared, not of the installation.
- **A third-party analytics service**, which was rejected once and stays rejected
  (D260809h).

## How we will know it worked

- Administration answers who opened what and when, for a link and for an album,
  with no mail having been sent and no switch turned on.
- A link is sent, and within minutes a message says it was opened, without anybody
  having gone to look.
- One mail a week says whether anybody came back, in a line per link and per
  album, short enough to read.
- Turning the switch off stops the messages and leaves the history intact.
