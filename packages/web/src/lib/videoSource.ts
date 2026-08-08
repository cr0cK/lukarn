/**
 * Quelle source d'une vidéo demander au serveur.
 *
 * La règle tient en une ligne, et c'est justement pour ça qu'elle vit ici : tant
 * qu'elle est fausse, rien ne la montre — la vidéo se lit, ou ne se lit pas, sans
 * qu'on sache laquelle des deux sources était en cause. Testée à côté de
 * `preview.ts`, et pour la même raison.
 */

/** L'original tel qu'il est dans Drive, ou la version préparée par le serveur. */
export type VideoSource = 'original' | 'transcoded';

/**
 * Choisit la source à partir du codec réellement contenu dans le fichier.
 *
 * `canPlayType` reçoit le codec, jamais `video/mp4` seul : à ce dernier, tous
 * les navigateurs répondent `maybe` et n'apprennent donc rien (D98). Avec le
 * codec, la réponse est franche — chaîne vide pour « je ne sais pas le lire ».
 *
 * L'original reste la valeur par défaut, y compris quand le codec est inconnu :
 * c'est le fichier en pleine qualité, et un doute ne justifie pas de servir une
 * version dégradée — ou pas encore prête. C'est aussi ce qui fait que Safari et
 * un iPhone, qui décodent l'HEVC, ne voient jamais le transcodage.
 */
export function chooseVideoSource(
  codec: string | null,
  canPlayType: (type: string) => string,
): VideoSource {
  if (!codec) return 'original';
  return canPlayType(`video/mp4; codecs="${codec}"`) === '' ? 'transcoded' : 'original';
}

/**
 * Sonde du navigateur courant, sur un élément détaché et réutilisé : créer un
 * `<video>` à chaque photo de la visionneuse serait un élément jeté par
 * changement de média.
 */
let probe: HTMLVideoElement | null = null;

export function canPlayVideoType(type: string): string {
  probe ??= document.createElement('video');
  return probe.canPlayType(type);
}
