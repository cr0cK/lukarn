# D75 — Le formatage et la numérotation des décisions sont contrôlés, plus laissés à la vigilance

**Contexte.** Deux dérives silencieuses se sont installées, chacune parce que
rien ne la mesurait.

Le formatage d'abord. `pnpm verify` enchaînait typecheck, lint, tests,
`check:specs` et `check:links` — pas de Prettier. `pnpm format` existait, en
écriture seule, et ne s'exécutait que si on y pensait. Cinq fichiers de `main`
s'en écartaient. Le coût réel n'est pas l'esthétique : la personne suivante qui
lance `pnpm format` reformate au passage le travail de quelqu'un d'autre, et son
diff mélange son correctif à des retouches qui ne sont pas les siennes.

La numérotation des décisions ensuite. Elle se fait à la main, et rien ne
l'arbitrait. Une entrée a été numérotée `D60` alors que le fichier allait
jusqu'à `D64` : `main` a porté deux `## D60`. Puis trois branches parallèles ont
chacune ajouté « la suivante » — toutes les trois `D65`, sans se voir, puisque
chacune partait du même dernier numéro. Le défaut le plus coûteux n'est pourtant
ni l'un ni l'autre : c'est le renvoi `(Dxx)` décalé, qui reste syntaxiquement
correct et désigne une décision qui parle d'autre chose. Il ne casse rien, se
lit sans accroc, et raconte faux.

**Choix.** `check:format` — un `prettier --check .` — entre dans `verify`, à
côté de `lint` : deux barrières de style, au même endroit. Et `check-specs.mjs`
gagne une section « Décisions » qui refuse un numéro défini deux fois, ainsi
qu'un renvoi `(Dxx)` vers une entrée absente, dans les specs **comme dans le
code** — un commentaire qui justifie une ligne par une décision est la forme la
plus utile du renvoi, et la plus facile à laisser pourrir.

**Écarté.** Un `pre-commit` qui lancerait `prettier --write` : il réécrit les
fichiers sous les doigts de qui commite, et le dépôt a déjà tranché contre
`pre-commit` au profit de `pre-push` — commiter une étape intermédiaire est
légitime, publier un état qui ment ne l'est pas.

Écarté aussi : attribuer les numéros automatiquement. Un outil qui renumérote
réécrit des entrées publiées et les renvois qui les visent, ce qui contredit la
règle « nouvelle entrée, on ne réécrit pas les anciennes ». Le contrôle constate,
il n'arbitre pas.

Écarté enfin : signaler les trous dans la suite. Un trou est sans conséquence,
et le contrôle se déclencherait sur un retrait légitime. Un contrôle bruyant
finit désactivé — c'est déjà la raison d'être de `MODULES_TOLERES`.

Le contrôle ne va pas dans `check-links.mjs`, malgré la parenté : un `(D67)` en
texte brut n'est pas un lien markdown, et un `[D67](./D67-la-file-de-moderation-est-une-liste-de-travail-pas-un-flux.md)` désigne
le fichier, jamais l'entrée. Cet outil résout des chemins et des ancres ; celui
des décisions lit un fichier et compte.

**Conséquences.** `verify` passe de cinq étapes à six. La collision de numéros
n'est pas empêchée — deux branches parallèles peuvent toujours choisir `D65`
chacune de leur côté, et rien ne peut l'éviter tant que le numéro se choisit à
l'écriture. Elle est en revanche impossible à faire atterrir : la seconde échoue
à la fusion, là où le conflit se voit et se résout.

Un renvoi `(Dxx)` dans le code devient porteur : renuméroter une décision sans
suivre ses mentions fait échouer la CI. C'est l'effet recherché, et il vaut pour
les tests et les commentaires autant que pour les specs.

Les cinq fichiers qui avaient dérivé sont reformatés ici, sans rapport avec le
sujet de ce travail : c'est l'arriéré de la dérive, payé une fois.
