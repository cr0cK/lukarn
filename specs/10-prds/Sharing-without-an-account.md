---
type: prd
target-repos:
  - lukarn
---

# Sharing an album, or one photograph, with somebody who has no account

## Why this exists

Showing an album to somebody outside the household means one of two things today.
Either they are given a password that was made for a family and already circulates
further than intended, or an account is created for a person who will open it once
and never come back. Both leave a credential behind that nobody remembers to
remove, and the second one asks the recipient to keep something they did not want.

The result is that most photographs are never shown to the person in them.

## Who it is for

- **The person who runs the instance**, who is usually also the one taking the
  photographs. They want to send an album to a cousin without administering
  anything, and to take it back later without a conversation about it.
- **The recipient**, who did not choose this application, holds no password, and
  will open what they were sent on a phone, once, from a message.
- **The moderator**, who is the same person wearing the other hat, and who needs
  to know which invitation a comment arrived through before deciding anything
  about it.

## What it changes

A shared link opens an album, or a single photograph, with no password asked. Each
link carries a name chosen when it is made, so it can be cut off on its own and
read on its own: cutting one recipient off leaves the others untouched.

Whoever opens a link can comment, after proving their address with the code the
application already sends for that purpose. Nothing about commenting changes for
them, and nothing about it changes for anybody else.

Every link the instance has issued sits in one list, whatever it covers, with when
it was last opened. Revoking one takes a click, and the link stops working on the
next request it makes.

**Sharing one photograph is not a small album.** The album it came from is named
nowhere the recipient can reach: not on the page, not in the address they were
sent, not in the mail carrying their code, and not in anything sent to them
afterwards. What they were given is one photograph, and that is the whole of what
they can see.

## Slices

- An album opens through a link with no password. The link is made from the album,
  carries a name, and can be revoked.
- The same for one photograph, with no trace of the album it belongs to.
- Commenting through a link, on the photographs of a shared album or on the single
  photograph that was shared.
- One place listing every link the instance has issued, where a link is renamed,
  revoked, and read for its use.
- The record of use: when each link was last opened, and when before that.

## What was already settled

These are consequences of rules the instance already follows. They are here
because they shape what a recipient experiences, and because two of them will
surprise somebody who expects a sharing feature to behave like a consumer one.

- **Revoking takes effect on the next request.** There is no delay to wait out and
  no cache to clear on the server (D11).
- **Revoking does not un-see.** Photographs already loaded stay in the recipient's
  browser for up to a year, and no setting changes that. They were shown, and
  could have been saved to a disk at any point. Revoking stops what comes next
  (D43).
- **Commenting still requires a verified address**, proved by a six-digit code
  sent to it. Where no mail server is configured, nobody can comment at all,
  through a link or otherwise (D39).
- **A comment carries the name its author gave**, never their address. The address
  is visible only in moderation, which needs to know who is speaking behind a
  declared name (D38).
- **Hiding a comment happens after publication and is reversible.** Nothing a
  visitor writes waits for approval (D36).
- **Opening a shared album subscribes its visitor to that album's updates** once
  they have verified an address. This is announced where they give the address and
  undone in one click (D41). A shared photograph subscribes nobody, because there
  is no album on offer to subscribe to.
- **A link that was revoked says so**, rather than looking like a mistyped
  address. A link that never existed still says nothing at all (D260824h).

## Decision Record

Six questions asked over two rounds, and two contradictions raised against rules
in force. Six struck as already answered by the decision log.

| #   | Question                                                 | Answer                                                   | Implication                                                                                                               |
| --- | -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | One link per album, or several?                          | Several, each named                                      | Revocation and the record of use are per recipient rather than per album (D260824b)                                       |
| 2   | Does a link expire on its own?                           | Only if given a date, and none by default                | A link lives until revoked; the forgotten link is an accepted risk the list is meant to surface (D260824c)                |
| 3   | Can a single shared photograph be commented on?          | Yes, by the same mechanism                               | The thread attaches to the photograph, and the album stays invisible to its author (D260824d)                             |
| 4   | What does the page show, and is it indexable?            | Name and logo, nothing else, not indexable               | The recipient can tell who sent it without learning that accounts exist here (D260824e)                                   |
| 5   | Who may create a link?                                   | Administrators only                                      | A shared family password cannot turn an album into a public gallery (D260824f)                                            |
| 6   | Where is a link created, and where managed?              | Created on the album or photograph, managed in one place | Two surfaces, one job each (D260824g)                                                                                     |
| 7   | _Challenge:_ usage is counted by day, and you asked when | The rule is amended for links only                       | A link's uses are recorded with their time, because the question is a credential's history rather than traffic (D260824i) |
| 8   | _Challenge:_ every refusal returns "not found"           | The rule gains a second exception                        | A revoked link tells its holder it was revoked (D260824h)                                                                 |

Answer 7 deviated from the recommendation, which was to keep one shape of
measurement and accept day-level precision. The cost accepted in exchange is
recorded in D260824i: a named link with a timestamp is a record of when one
identified person looked at the photographs.

## Out of scope

- **Signing in with an outside identity.** Rejected on its own grounds, and those
  grounds still hold (D33).
- **Public registration.** Nobody creates an account here, and a link is not a
  step towards one.
- **Uploading or changing anything through a link.** A link reads.
- **A link covering more than one album**, or the instance as a whole. What a link
  opens is one album or one photograph, chosen when it is made.
- **A password on a link.** That is an account with extra steps, and accounts
  already exist.
- **Anything shown to the recipient about their own visits.** What is recorded
  exists to govern the link, and it is read by the person who issued it.

## How we will know it worked

- An album can be sent to somebody with no account, and taken back, without
  anybody touching accounts.
- A photograph can be sent on its own, and its recipient can neither see nor name
  the album it came from.
- Every link ever issued is findable in one place, and each one says when it was
  last opened.
- A comment written through a link can be traced to the invitation that carried
  it, without asking its author anything.
