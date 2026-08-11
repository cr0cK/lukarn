# D260811 — Le dépôt s'appelle nonni et se publie sous AGPL-3.0

**Contexte.** Le dépôt part en open source, et deux manques l'en empêchaient. Le
premier est juridique : sans fichier de licence, le code reste sous droit
d'auteur plein, et personne ne peut légalement l'exécuter, le modifier ni le
redistribuer — un dépôt public sans licence n'est pas un projet libre, c'est du
code lisible. Le second est le nom. `googledrive-viewer` et « Google Drive Photo
Viewer » reprennent une marque dans le nom du produit, ce que les règles d'usage
des marques de Google interdisent ; la forme admise nomme le service sans se
l'approprier — « pour Google Drive », jamais « Google Drive quelque chose ».

**Choix.** Le projet s'appelle **nonni** — les grands-parents, en italien : ceux
pour qui l'application a été écrite, et qui voulaient voir les photos sans qu'on
leur impose un compte Google au préalable. Un nom court, sans marque, qui dit à
qui ça servait avant de dire ce que ça fait.

La licence est **AGPL-3.0-only**. C'est une application serveur : le copyleft de
la GPL ne se déclenche qu'à la distribution d'un binaire, ce qui ne se produit
jamais ici, et laisserait donc un tiers en faire un service hébergé fermé sans
rien rendre. L'article 13 de l'AGPL est le seul qui couvre ce cas — qui héberge
une version modifiée et l'ouvre à des utilisateurs doit leur en offrir les
sources. Pour qui auto-héberge sans modifier, la contrainte est nulle.

**Écarté.** MIT et Apache-2.0, qui maximisent l'adoption et les contributions
ponctuelles, mais autorisent exactement ce que l'AGPL empêche. Écartée aussi
GPL-3.0, dont la réciprocité ne mord pas sur un logiciel qu'on n'expédie pas.
Écarté enfin le maintien du nom avec une simple mention de non-affiliation : elle
est nécessaire — le `README.md` la porte — mais elle ne répare pas un nom de
produit construit sur la marque.

**Conséquences.** Le renommage ne s'arrête pas au titre du `README.md` : il
traverse les paquets (`@nonni/{shared,server,web}`), l'image du compose, les
volumes (`nonni-data`, `nonni-cache`), le fichier de base (`nonni.db`), les
cookies (`nonni_session`, `nonni_oauth_state`), les clés de `localStorage`
(`nonni:*`), les emplacements CSS (`--nonni-*`), l'agent utilisateur envoyé au
géocodeur, les unités systemd de sauvegarde et le remote rclone par défaut.

Trois de ces renommages se paient à la mise à jour d'une instance en service :

- **Les volumes et la base ne s'adoptent pas d'eux-mêmes.** Sans la migration
  décrite dans `deploy/README.md`, le premier `docker compose up` démarre sur une
  base vide, comptes et index compris — le même piège que D53, pour la même
  raison, et il fallait donc le documenter au même endroit.
- **Le cookie de session change de nom**, donc toutes les sessions ouvertes
  cessent d'être reconnues : chacun se reconnecte une fois. Les lignes en base
  survivent et restent révocables, seul le cookie qui les désignait a disparu.
- **Les repères de lecture repartent de zéro** (D55, D82, D99) : ils vivent dans
  le navigateur sous une clé renommée. Les commentaires déjà lus se signalent
  donc à nouveau comme neufs, une fois.

Les archives de sauvegarde déjà écrites gardent leur préfixe `gdv-`, que
l'élagage de `deploy/backup.sh` ne reconnaît plus : elles ne seront pas
supprimées toutes seules.

**Ce que ça ne fait pas.** D53 n'est pas réécrite. Elle raconte l'époque où les
volumes tiraient leur nom du répertoire de clonage, et remplacer `gdv-data` par
`nonni-data` dans son contexte rendrait son récit incompréhensible — un journal
nomme ce qui a été remplacé. Les décisions qui citaient un identifiant **encore
vivant** dans le code, en revanche, portent le nouveau nom : sans quoi elles
décriraient du code introuvable.

L'article 13 n'est pas encore honoré côté interface. Il ne pèse que sur qui
modifie et héberge, mais l'usage veut qu'une application web offre d'elle-même le
lien vers ses sources ; la place naturelle est le pied de `/diagnostic`, et c'est
à faire.
