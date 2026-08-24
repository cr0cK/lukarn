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
remove, and the second asks the recipient to keep something they did not want.

The result is that most photographs are never shown to the person in them.

## Who it is for

- **The person who runs the instance**, usually also the one taking the
  photographs. They want to send an album to a cousin without administering
  anything, and to take it back later without a conversation about it.
- **The recipient**, who did not choose this application, holds no password, and
  will open what they were sent on a phone, once, from a message.
- **The moderator**, the same person wearing the other hat, who needs to know which
  invitation a comment arrived through before deciding anything about it.

## What it changes

A shared link opens an album, or a single photograph, with no password asked. Each
link carries a name chosen when it is made, so it can be cut off on its own and
read on its own: cutting one recipient off leaves the others untouched. A link with
no name has to be revoked from a note kept somewhere else, and that is the note
nobody keeps.

A link lives until it is revoked, and can be given an expiry date it does not have
by default. This gallery is opened three times a year by people who were sent a
link once, and a link that dies on its own becomes a telephone call in which the
administrator learns about the expiry from the person it inconvenienced.

**Only an administrator makes, renames or revokes a link.** An account here is an
access key a household may share (D38), and that password already circulates
further than intended; letting it publish an album without a password turns a leak
into a public gallery.

A link is made **from the album or the photograph it covers**, because the wish to
share arrives while looking at one, and sending somebody to an administration
screen for it is what makes them attach a file to a message instead. Every link the
instance has issued is listed in **one administration section**, whatever it
covers, and that is where it is renamed, revoked and read for its use. A link found
only where it was created cannot be revoked by anybody who has forgotten which
album it belonged to.

The page a link opens carries the instance's name, its logo and what was shared. It
carries no album list, no sign-in control and no sign that other content exists,
and it asks search engines not to index it. A page whose sender cannot be
identified has the shape of a phishing message; a page offering a password field
advertises that this instance has accounts to guess at.

Whoever opens a link can comment, after proving their address with the code the
application already sends for that purpose. Nothing about commenting changes for
them, and nothing changes for anybody else.

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
  revoked and read for its use.
- The record of use: when each link was last opened, and when before that.

## What was already settled

Consequences of rules the instance already follows. Two of them will surprise
somebody expecting a sharing feature to behave like a consumer one.

- **Revoking takes effect on the next request.** No delay to wait out, and no cache
  to clear on the server (D11).
- **Revoking does not un-see.** Photographs already loaded stay in the recipient's
  browser for up to a year, and no setting changes that. They were shown and could
  have been saved at any point. Revoking stops what comes next (D43).
- **Commenting still requires a verified address**, proved by a six-digit code sent
  to it. Where no mail server is configured, nobody can comment at all, through a
  link or otherwise (D39).
- **A comment carries the name its author gave**, never their address, which is
  visible only in moderation (D38).
- **Hiding a comment happens after publication and is reversible.** Nothing a
  visitor writes waits for approval (D36).
- **A comment retains which credential carried it**, the way it already retains the
  access key used, because that is what gets changed when something has circulated
  too widely (D38). A link's name is what the moderation queue can show.
- **Opening a shared album subscribes its visitor to that album's updates** once
  they have verified an address, announced where they give it and undone in one
  click (D41). A shared photograph subscribes nobody: there is no album on offer.

## Against what is decided

Two collisions, raised here and settled nowhere. Each is a work order for planning.

**A revoked link should say so, where D12 answers every refusal with "not found".**
D12 refuses an album or media item with 404 rather than 403 so that nobody learns
by probing that other people's albums exist, and already carries one deliberate
exception. Carried over unchanged it answers a revoked link with "page not found",
indistinguishable from a typing mistake for somebody who was legitimately sent that
link a month ago. **The owner's answer: the need stands.** What is asked for is
that a link which existed and no longer works says which of the two happened,
revoked or expired, while a token that never existed still says nothing at all.
What a stranger can discover by guessing is unchanged; what changes is what the
holder of a link that once worked is told.

**A link's uses are wanted with their times, where D260809h counts days.** D260809h
measures the instance in a table aggregated on write, one row per album, key,
session and day, and names the exact time of every gesture as a loss accepted on
grounds of scale. **The owner's answer: the need stands**, against a recommendation
to accept day-level precision. The argument put for it is that a credential's
history is a different question from traffic, read once at the moment somebody is
deciding whether to cut a link off, and that the scale which ruled out an event log
is absent here: a link is opened by a handful of people a handful of times. The
cost the owner accepted, written down so planning does not have to rediscover it —
a named link with a timestamp is a record of when one identified person looked at
the photographs, which is what D260809h declined to build for shared keys.

## Decision Record

Six questions over two rounds. Six struck as already answered by the decision log.

| #   | Question                                        | Answer                                                   | What was turned down                                                                                                                                                         |
| --- | ----------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | One link per album, or several?                 | Several, each named                                      | One per album: revoking cuts everybody, and the record could never say more than "somebody looked"                                                                           |
| 2   | Does a link expire on its own?                  | Only if given a date, none by default                    | A mandatory expiry, which turns a family link into a telephone call; no date at all, which loses "just for this week"                                                        |
| 3   | Can a single shared photograph be commented on? | Yes, by the same mechanism                               | A photograph that only shows, removing the reason to send one; a read-only thread, which hands relatives' names to whoever holds the link                                    |
| 4   | What does the page show, and is it indexable?   | Name and logo, nothing else, not indexable               | A bare page, which reads as phishing; the full application, which advertises the password field; indexing per link, whose mistake cannot be taken back                       |
| 5   | Who may create a link?                          | Administrators only                                      | Any account, when a shared password is D38's own premise; extending it to accounts bound to a person, a second rule for a case this instance does not have                   |
| 6   | Where is a link created, and where managed?     | Created on the album or photograph, managed in one place | Creation confined to administration, the longest path in front of the most frequent gesture; management confined to the album, which needs remembering what the link covered |

## Out of scope

- **Signing in with an outside identity.** Rejected on its own grounds, and those
  grounds still hold (D33).
- **Public registration.** Nobody creates an account here, and a link is not a step
  towards one.
- **Uploading or changing anything through a link.** A link reads.
- **A link covering more than one album**, or the instance as a whole. What a link
  opens is one album or one photograph, chosen when it is made.
- **A password on a link.** That is an account with extra steps, and accounts
  already exist.
- **Anything shown to the recipient about their own visits.** What is recorded
  exists to govern the link, and is read by the person who issued it.

## How we will know it worked

- An album can be sent to somebody with no account, and taken back, without anybody
  touching accounts.
- A photograph can be sent on its own, and its recipient can neither see nor name
  the album it came from.
- Every link ever issued is findable in one place, and each one says when it was
  last opened.
- A comment written through a link can be traced to the invitation that carried it,
  without asking its author anything.
