/**
 * Normalisations et validations des formulaires d'administration.
 *
 * Fonctions pures, sans React ni réseau. Elles ne remplacent pas le contrôle du
 * serveur — qui reste seul juge — elles évitent un aller-retour pour dire ce qui
 * cloche. Les règles viennent de `@nonni/shared`, pour que les deux côtés refusent
 * exactement les mêmes valeurs.
 */

import {
  ALBUM_ID_PATTERN,
  ALL_ALBUMS,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
} from '@nonni/shared';

/**
 * Extrait l'identifiant d'un dossier Drive de ce qui a été collé : URL complète,
 * lien de partage, ou identifiant seul.
 *
 * Drive n'expose que cet identifiant opaque ; un chemin lisible
 * (« Mon Drive/Photos ») n'en est pas un et est rejeté plutôt qu'envoyé au
 * serveur, qui répondrait par une erreur beaucoup moins parlante.
 */
export function extractFolderId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const fromPath = /\/folders\/([^/?#]+)/.exec(value);
  if (fromPath) return decodeURIComponent(fromPath[1]!);

  // Les vieux liens `open?id=` et `folderview?id=` circulent encore.
  const fromQuery = /[?&]id=([^&#]+)/.exec(value);
  if (fromQuery) return decodeURIComponent(fromQuery[1]!);

  // Reste soit un identifiant nu, soit un chemin ou une URL qu'on ne sait pas lire.
  if (/[/\\\s]/.test(value)) return null;
  return value;
}

/** Message d'erreur, ou `null` si la valeur est acceptable. */
export function validateUsername(value: string): string | null {
  const username = value.trim();
  if (!username) return 'Renseigne un identifiant.';
  if (username.length > USERNAME_MAX_LENGTH) {
    return `L'identifiant ne peut pas dépasser ${USERNAME_MAX_LENGTH} caractères.`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return 'Lettres, chiffres, point, tiret ou tiret bas, en commençant par une lettre ou un chiffre.';
  }
  return null;
}

/** Message d'erreur, ou `null`. Un identifiant d'album sert aussi d'URL. */
export function validateAlbumId(value: string): string | null {
  const id = value.trim();
  if (!id) return 'Renseigne un identifiant.';
  if (!ALBUM_ID_PATTERN.test(id)) {
    return 'Lettres, chiffres, point, tiret ou tiret bas, en commençant par une lettre ou un chiffre.';
  }
  return null;
}

/**
 * Message d'erreur, ou `null`. En modification, un champ vide signifie
 * « ne pas changer le mot de passe » : c'est le seul cas où le vide est valide.
 */
export function validatePassword(value: string, required = true): string | null {
  if (!value) return required ? 'Renseigne un mot de passe.' : null;
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }
  return null;
}

/** Message d'erreur, ou `null`. */
export function validateTitle(value: string): string | null {
  return value.trim() ? null : 'Renseigne un titre.';
}

/** Message d'erreur pour le champ « dossier Drive », ou `null`. */
export function validateFolderInput(value: string): string | null {
  if (!value.trim()) return 'Renseigne le dossier Drive.';
  if (extractFolderId(value) === null) {
    return "Colle l'URL du dossier Drive ou son identifiant — le segment après /folders/.";
  }
  return null;
}

/**
 * Propose un identifiant d'album à partir du titre saisi. Sans accents ni
 * espaces : l'identifiant se retrouve dans l'URL de l'album.
 */
export function slugifyAlbumId(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Le motif partagé impose de commencer par une lettre ou un chiffre.
  return slug.slice(0, USERNAME_MAX_LENGTH);
}

/** Nombre saisi en français : la virgule décimale est acceptée. `null` si illisible. */
export function parseNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

/** Message d'erreur pour l'intervalle de synchronisation, ou `null`. */
export function validateIntervalMinutes(value: string): string | null {
  const minutes = parseNumber(value);
  if (minutes === null || !Number.isInteger(minutes)) {
    return 'Indique un nombre entier de minutes (0 pour désactiver).';
  }
  return null;
}

/** Message d'erreur pour la taille maximale du cache, ou `null`. */
export function validateCacheSizeGB(value: string): string | null {
  const size = parseNumber(value);
  if (size === null) return 'Indique une taille en gigaoctets.';
  if (size <= 0) return 'La taille du cache doit être supérieure à 0.';
  return null;
}

/** Nombre d'albums cités en clair avant de basculer sur « et N autres ». */
const NAMED_ALBUMS = 3;

/**
 * Résume en une ligne les albums accessibles à un compte. Le joker est nommé
 * comme tel : « tous les albums » et « les 12 albums cochés » ne veulent pas
 * dire la même chose une fois le treizième créé.
 */
export function formatAlbumAccess(albums: string[], titles: ReadonlyMap<string, string>): string {
  if (albums.includes(ALL_ALBUMS)) return 'Tous les albums, présents et à venir';
  if (albums.length === 0) return 'Aucun album';

  // Un album supprimé peut subsister dans la liste d'un compte : on affiche
  // alors son identifiant brut plutôt que de le passer sous silence.
  const named = albums.slice(0, NAMED_ALBUMS).map((id) => titles.get(id) ?? id);
  const rest = albums.length - named.length;
  return rest > 0 ? `${named.join(', ')} et ${rest} autre${rest > 1 ? 's' : ''}` : named.join(', ');
}
