# D15 — Le jeton révoqué est conservé, pas supprimé

**Contexte.** Google peut refuser le refresh token (`invalid_grant`) sans
prévenir : accès retiré, six mois d'inactivité, application repassée en « Test ».

**Choix.** `DriveService.guard()` détecte l'erreur, date `revoked_at` et lève une
`DriveRevokedError` typée. La ligne `oauth_token` reste, avec son compte.

**Écarté.** Supprimer la ligne. Une table vide se lit comme une installation
neuve, alors qu'il faut dire à l'administrateur _quel_ compte a perdu son
autorisation et qu'il s'agit de reconnecter, pas de connecter.

**Conséquences.** `authorizedClient()` échoue immédiatement une fois révoqué,
sans rappeler Google. `syncAll` interrompt sa boucle sur cette erreur : les
albums suivants échoueraient de la même façon. Les routes média traduisent en
`503 drive_revoked`. Une erreur réseau ou un 500 de Google ne déclenche **pas**
la révocation — `packages/server/test/revocation.test.ts` le vérifie.
