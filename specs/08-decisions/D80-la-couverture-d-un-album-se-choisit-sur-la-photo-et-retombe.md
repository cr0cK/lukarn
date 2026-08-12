# D80 — An album cover is chosen on the photo and falls back automatically

**Context.** The cover displayed on the home page was always the album's most
recent photo. For a holiday album, that is the journey home; for a ten-year
"children" album, it is whatever was uploaded yesterday. The thumbnail
representing the album represented nothing, and there was no way to change it.

**Choice.** An `albums.cover_media_id` column carries the choice, with `NULL`
meaning "automatic". The action lives in the viewer and is restricted to the
administrator: a photo is chosen while viewing it at full size, not from a list
of filenames.

This is the same rule as the album description and day note — **input is in the
album; the mutation remains under `/api/admin`**, the only prefix responding with
403 (D50). Returning to automatic is a button in `/admin`: this is the only screen
that can say whether a cover was chosen or is the default, exactly the distinction
the button offers to undo.

**Fallback is permanent, and it is the heart of this entry.** The column has no
foreign key to `media`: `deleteStale` removes a photo as soon as a synchronisation
does not see it again — in the Drive bin before a rollback, a renamed folder, or
an interrupted sync. A cascade would erase the choice after a temporary indexing
problem. `MediaRepo.stats(albumId, chosenId)` therefore computes the cover on
read: the chosen photo when present, otherwise the most recent, without touching
the choice. Since the Drive identifier is stable, a returning photo automatically
becomes the cover again. The same reasoning had already rejected a foreign key on
`comments.media_id`.

Two homonymous fields follow and must be distinguished: `Album.coverId` is the
**served** cover, while `AdminAlbum.coverId` is the **choice** — `null` for
automatic. Confusing them would display "chosen cover" beside every album.

**Rejected.** A grid picker in `/admin`. This was the literal request, but it
would reproduce the album grid for no reason, and above all only works if the
administrator account can access the album: thumbnails go through `/api/media`,
where `canSee` responds with 404 for someone without the album. The first
administrator has the `*` wildcard, but nothing requires this, and opening media
access to administrators for selection convenience would move a partitioning
rule for cosmetic reasons.

Also rejected: leaving the cover empty when the chosen photo disappears.
Explicit, but a blank tile on the home page with no explanation is a defect, not
a signal.

**Consequences.** A video cannot be a cover, by choice or fallback: the pipeline
does not render a thumbnail for it, and the album would have no image. The route
rejects `400 unknown_cover` for a photo outside the album or a video, rather than
accepting it and silently falling back — silence would reveal the problem on the
home page, far from the action.

The viewer action is the only one without a keyboard shortcut. A cover is chosen
once per album, and the `?` help is for every visitor, not only the administrator.

Changing an album's Drive scope empties its index (D50), and therefore its cover,
until resynchronisation. The choice survives: if the photo is still in the new
folder, it becomes the cover again without any action.
