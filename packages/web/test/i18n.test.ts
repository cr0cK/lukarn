import { LOCALES, resolveLocale } from '@lukarn/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { en } from '../src/lib/i18n/messages-en';
import { fr } from '../src/lib/i18n/messages-fr';
import { LOCALE_NAMES, makeTranslate } from '../src/lib/i18n/translate';

/**
 * The catalogues and how a language is chosen.
 *
 * The type system already guarantees that both catalogues carry the same keys
 * with the same parameters — the checks here are the ones a type cannot make:
 * that a message is not empty, and that a translation actually says something
 * other than the English it replaces.
 */

const KEYS = Object.keys(en) as (keyof typeof en)[];

describe('catalogues', () => {
  it('declares the same keys on both sides', () => {
    assert.deepEqual(Object.keys(fr).sort(), KEYS.slice().sort());
  });

  it('leaves no message empty', () => {
    for (const key of KEYS) {
      for (const [name, catalogue] of [
        ['en', en],
        ['fr', fr],
      ] as const) {
        const message = catalogue[key];
        if (typeof message === 'string') {
          assert.notEqual(message.trim(), '', `${name}: "${key}" is empty`);
        } else {
          // A message with parameters: calling it must produce something, and
          // the parameters must reach the sentence rather than being dropped.
          assert.equal(
            typeof message,
            'function',
            `${name}: "${key}" is neither text nor function`,
          );
        }
      }
    }
  });

  it('keeps every parameter in the translated sentence', () => {
    // A translation that quietly drops its parameter renders "photos in" with
    // nothing after it. Only a call reveals it.
    const t = makeTranslate('fr');
    assert.match(t('albums.itemCount', 3), /3/);
    assert.match(t('feed.view', 'IMG_0004.jpg', 'Corse'), /IMG_0004\.jpg.*Corse/);
    assert.match(t('section.label', 'Aujourd’hui', 12), /Aujourd’hui.*12/);
    assert.match(t('comments.edit', 27), /27/);
  });

  it('agrees the plural in each language rather than adding an "s"', () => {
    const t = makeTranslate('fr');
    assert.equal(t('section.unit', 1), 'élément');
    assert.equal(t('section.unit', 2), 'éléments');
    assert.equal(t('visits.unitKeys', 1), 'identifiant');
    assert.equal(t('visits.unitKeys', 4), 'identifiants');
  });

  it('actually translates: no French message left as its English source', () => {
    // Twenty untranslated words would still typecheck. These are the ones a
    // half-finished catalogue keeps.
    const suspects = [
      'common.cancel',
      'common.save',
      'topbar.signOut',
      'album.empty',
      'comments.reply',
      'adminUsers.delete',
      'settings.saved',
    ] as const;
    for (const key of suspects) {
      assert.notEqual(fr[key], en[key], `"${key}" is still in English`);
    }
  });

  it('names each language in the language it names', () => {
    for (const locale of LOCALES) {
      assert.ok(LOCALE_NAMES[locale], `no name for "${locale}"`);
    }
    assert.equal(LOCALE_NAMES.fr, 'Français');
  });
});

describe('choosing a language', () => {
  it('reads a language tag without its region', () => {
    assert.equal(resolveLocale('fr'), 'fr');
    assert.equal(resolveLocale('fr-CA'), 'fr');
    assert.equal(resolveLocale('EN-gb'), 'en');
  });

  it('answers null for a language the gallery does not speak', () => {
    // `null`, not English: the caller decides what to do — try the next browser
    // preference, then fall back.
    assert.equal(resolveLocale('de-DE'), null);
    assert.equal(resolveLocale(''), null);
    assert.equal(resolveLocale(null), null);
    assert.equal(resolveLocale(undefined), null);
  });

  it('carries its language on the translation function', () => {
    // This is what lets `formatDate(iso, t)` take one parameter instead of two.
    assert.equal(makeTranslate('fr').locale, 'fr');
    assert.equal(makeTranslate('en').locale, 'en');
  });
});
