# D14 — Refresh token chiffré au repos

**Contexte.** Le jeton donne la lecture de tout le Drive du propriétaire et vit
dans un fichier SQLite sur un VPS.

**Choix.** AES-256-GCM, clé dérivée par scrypt d'un sel tiré à chaque
chiffrement, `TOKEN_KEY` fournie par l'environnement et jamais écrite en base.

**Écarté.** Stocker le jeton en clair — un dump de la base suffirait alors. Le
sel aléatoire par chiffrement écarte aussi la variante « clé dérivée une fois au
démarrage », qui rendrait deux chiffrements du même jeton identiques et
révélerait qu'il n'a pas changé.

**Conséquences.** Sauvegarder `gdv-data` sans le `.env` ne sert à rien : le jeton
serait indéchiffrable. Si `TOKEN_KEY` change, le tag GCM échoue, le jeton est
supprimé et `/admin` affiche « non connecté » plutôt que de boucler sur une
erreur.
