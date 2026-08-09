# D6 — Pas de transcodage vidéo

**Contexte.** Les vidéos du Drive sont en MP4 et MOV, parfois volumineuses.

**Choix.** `GET /api/media/:id/original` relaie le header `Range` tel quel vers
Drive et recopie `Content-Length` / `Content-Range` de la réponse. Le navigateur
lit le format d'origine, avec seek natif.

**Écarté.** ffmpeg à la demande ou en tâche de fond : le CPU d'un VPS modeste ne
suit pas, il faudrait stocker les versions transcodées, et gérer une file de
travaux. Écarté aussi : réécrire le `Range` côté serveur, ce qui obligerait à
recomposer les réponses `multipart/byteranges`.

**Conséquences.** Un format que le navigateur ne sait pas lire n'est pas lisible
du tout — pas de repli. `media/range.ts` refuse donc les plages multiples et les
unités autres que `bytes` : un `Range` non conforme est **ignoré** et le fichier
entier est servi, comme le recommande la RFC 9110.
