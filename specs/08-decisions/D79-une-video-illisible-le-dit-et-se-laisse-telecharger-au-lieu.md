# D79 — Une vidéo illisible le dit et se laisse télécharger, au lieu de charger indéfiniment

**Contexte.** [D6](./D6-pas-de-transcodage-video.md) écarte le transcodage et en
énonce la conséquence : « un format que le navigateur ne sait pas lire n'est pas
lisible du tout — pas de repli ». La conséquence était juste ; l'interface ne la
traitait pas. La balise `<video>` de la visionneuse écoutait `loadeddata` et rien
d'autre. Un échec de lecture laissait donc `loaded` à `false` pour toujours, et
le tourniquet tournait sur un écran noir, sans un mot.

Deux causes ordinaires, vérifiées l'une et l'autre dans un navigateur :

- **Le codec.** Un iPhone filme en HEVC dès que « Haute efficacité » est actif,
  ce qui est le réglage d'usine. Chrome sur Linux et Windows ne décode pas
  HEVC : `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`. Le cas n'a rien d'exceptionnel
  pour une galerie familiale alimentée depuis des téléphones.
- **La source.** Drive indisponible, jeton révoqué, quota : `/original` répond
  503, et le lecteur s'arrête sur la même erreur silencieuse.

**Décision.** `error` sur la balise remplace le lecteur par un message et un
bouton **Télécharger**. La combinaison affichée n'est pas décidée en JSX mais par
`previewOverlay` (`lib/preview.ts`), qui servait déjà la photo — la vidéo passe
`measured: false`, n'ayant pas d'aperçu serveur à montrer. La règle est ainsi
tenue à un seul endroit, celui qui est testé sur toutes ses combinaisons.

Le message nomme le format plutôt que de dire « une erreur est survenue » : la
vidéo est presque toujours intacte, et lisible sur un autre appareil. Le
téléchargement est le seul repli que D6 laisse — c'est le fichier d'origine, que
le serveur relaie déjà.

**Écarté.** Transcoder à la volée les formats non lus : c'est exactement ce que
D6 refuse, et le motif n'a pas changé. Écarté aussi : sonder `canPlayType` avant
d'afficher, pour prévenir plutôt que constater. La réponse `maybe` de tous les
navigateurs sur `video/mp4` n'apprend rien du codec réellement contenu, et le
`mimeType` de Drive ne descend pas jusqu'au codec — le sondage se tromperait
dans les deux sens, là où `error` constate ce qui s'est réellement passé.

**Conséquences.** Le tourniquet est désormais un état borné : il s'arrête sur
une image ou sur un message. La vignette de la grille, elle, ne change pas —
une vidéo y reste une tuile sobre portant sa durée, et rien ne distingue à cet
endroit celle qui se lira de celle qui ne se lira pas ; il faudrait décoder
pour le savoir.
