/**
 * Ce qu'on montre pendant qu'une **photo** se prépare : aperçu flou, indicateur
 * d'activité, message d'échec.
 *
 * Isolé ici parce que la règle est facile à casser sans que rien n'échoue : une
 * combinaison fausse ne produit pas d'erreur, seulement un écran trompeur. Le
 * cas manqué est l'aperçu flou affiché **sans** indicateur — on ne voit alors
 * pas une photo qui charge, mais une photo floue, et on conclut que
 * l'application est cassée.
 *
 * La vidéo n'y passe plus : elle n'a que deux états, lue ou illisible. Son
 * attente est couverte par le `poster` de la balise et par les contrôles natifs
 * du navigateur, qui portent déjà leur propre indicateur — en superposer un
 * second en faisait tourner deux, l'un sur l'autre (D98).
 */

export interface PreviewInput {
  /** Le rendu demandé est arrivé et décodé. */
  loaded: boolean;
  /** Le rendu n'a pas pu être obtenu. */
  failed: boolean;
  /** Faux tant que les dimensions ne sont pas connues : rien à positionner. */
  measured: boolean;
}

export interface PreviewOverlay {
  /** Vignette agrandie et floutée, en attendant le rendu définitif. */
  placeholder: boolean;
  /** Indicateur d'activité : dit que le flou est une attente, pas un résultat. */
  spinner: boolean;
  /** Message d'échec, à la place de tout le reste. */
  error: boolean;
}

/**
 * Un aperçu flou n'est jamais montré seul : il est toujours accompagné de
 * l'indicateur, et les deux disparaissent ensemble.
 *
 * L'indicateur apparaît même sans aperçu — dimensions inconnues, donc rien à
 * afficher en attendant : un écran noir muet serait pire encore.
 */
export function previewOverlay({ loaded, failed, measured }: PreviewInput): PreviewOverlay {
  if (failed) return { placeholder: false, spinner: false, error: true };
  if (loaded) return { placeholder: false, spinner: false, error: false };
  return { placeholder: measured, spinner: true, error: false };
}
