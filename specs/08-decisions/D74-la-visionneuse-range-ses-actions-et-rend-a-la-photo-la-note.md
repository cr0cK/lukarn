# D74 — The viewer organises its actions and restores the day's note to the photo

**Context.** Two defects in the same place on a phone. The six header actions
left only 121 px for the title, so the date remained truncated even after
tightening the icons. More importantly, **opening a photo made its description
disappear**: the grid displays the day's note and place in the section header,
while the viewer received neither.

This is the view people will use most — photos are viewed on a phone.

**Choice.** Below `sm`, Info, Zoom, Download, and Full screen move into a kebab
menu. The title block grows to 235 px and the full date appears. The Info panel
now opens with two rows, "Place" and "That day", before EXIF.

**`Comments` is the only action that remains inline** at every width: its icon
carries the unread badge, the only sign that a photo has been commented on. Put
in a menu, it would no longer signal anything — an indicator that requires
opening a menu to see is not an indicator.

**Rejected.** Putting all five actions in the menu: the title would gain another
38 px at the cost of this badge. Also rejected: keeping Info inline beside
Comments — the title fell back to 197 px, and the date only just fitted, with no
margin for a long filename.

Above all, rejected: **a true caption per photo.** That is what the request
called for, but it does not exist in the model — it would require a column, a
migration, an administration screen, a route, and a shared contract. The day note
already exists, is entered from the album, and meets the same need in nearly all
cases: what describes a holiday photo is the day and place. Work on per-photo
captions remains open; it is simply not in this PR.

Finally rejected: displaying the note as an overlay beneath the photo. Always
visible with no tap — but another strip over an already small image on a phone,
in an application built on chrome not competing with photos.

**Consequences.** `useAlbumDays` is called regardless of grouping, not only in
"by day" mode: one request per album, whose response only contains days with
something to show. Otherwise, the note would only appear in albums grouped by
day.

On a large screen, `Comments` moves **before** Info instead of after it. This is
the price of a fixed position and the right tradeoff: the only action that never
moves is the one that must be easy to locate.

The kebab menu is extracted into `components/ActionMenu.tsx`, shared with
`TopBar` ([D73](./D73-la-barre-superieure-tient-sur-une-rangee-et-declare-ses-au.md)).
What matters in this component is not its appearance but its three closing rules
— outside click, `Escape` with focus restoration, and closing before the action —
which would have been rewritten incorrectly the second time. Its `Escape`
listener uses capture and stops propagation; otherwise, one press would close
the menu **and** the photo.
