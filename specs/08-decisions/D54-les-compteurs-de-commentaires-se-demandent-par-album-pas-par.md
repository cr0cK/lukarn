# D54 — Les compteurs de commentaires se demandent par album, pas par photo

**Contexte.** La visionneuse doit signaler qu'une photo porte une conversation
**avant** qu'on ouvre quoi que ce soit — c'est le seul moment où l'information
sert à quelque chose. Or `MediaDetail.commentCount` n'est chargé qu'à l'ouverture
du panneau, précisément pour éviter une requête par photo regardée.

**Choix.** `GET /api/comments/:albumId` rend `{ counts: Record<mediaId, number> }`
pour l'album entier, en une requête `GROUP BY media_id` sur `idx_comments_thread`.
Les photos sans commentaire sont omises : sur un album de milliers de vues dont
une dizaine porte une conversation, la réponse tient en quelques centaines
d'octets. `MediaDetail.commentCount` reste pour l'onglet du panneau ouvert.

**Écarté.** _Ajouter `commentCount` à `MediaItem`_, donc à chaque page de la
grille. `MediaRepo` ignore délibérément l'existence des commentaires — sans quoi
la moindre requête média devient une jointure de plus — et l'y introduire aurait
fait payer ce coût à tous les appels, y compris ceux qui n'affichent pas de
pastille. _Charger le détail de chaque photo atteinte_ : parcourir un album à la
flèche déclencherait une requête par photo traversée, pour un chiffre qui arrive
après coup.

**Conséquences.** La pastille peut être en retard sur une conversation ouverte
ailleurs, et ce retard **n'est pas borné par les 30 s de `staleTime`** — il faut
le dire, l'inverse se déduirait naturellement du réglage. `refetchOnWindowFocus`
est à `false` globalement, `useCommentCounts` ne pose aucun `refetchInterval`, et
le hook n'est appelé que depuis la visionneuse : tant qu'elle reste ouverte,
aucune requête ne repart. Le `staleTime` n'agit donc que sur le `refetchOnMount`
d'une **réouverture** de la visionneuse, et c'est ce qui borne réellement le
retard. Publier depuis le panneau, lui, invalide les compteurs immédiatement.
Un album où presque toutes
les photos seraient commentées rendrait une réponse proportionnelle au nombre de
photos ; ce n'est pas l'usage visé, et le jour où il le deviendrait, la pagination
se poserait comme elle se pose déjà pour les médias.
