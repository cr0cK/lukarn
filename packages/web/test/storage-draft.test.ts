import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  draftErrors,
  draftFromSettings,
  draftPayload,
  draftUpdate,
  emptyDraft,
  secretTyped,
  type S3Draft,
  type WebdavDraft,
} from '../src/lib/storageDraft';
import { extractContainer, validateContainerInput } from '../src/lib/adminForm';
import { makeTranslate } from '../src/lib/i18n/translate';

/**
 * The English catalogue, read without a provider: these functions produce text,
 * and a test that stubbed the translation would check its own stub.
 */
const t = makeTranslate('en');

/** A bucket with everything typed in, so a test can take one field back out. */
const S3: S3Draft = {
  kind: 's3',
  endpoint: 'https://s3.example.com',
  region: 'eu-west-3',
  bucket: 'famille',
  prefix: 'photos',
  pathStyle: true,
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI',
};

const WEBDAV: WebdavDraft = {
  kind: 'webdav',
  url: 'https://cloud.example.com/remote.php/dav/files/alexis',
  root: 'Photos',
  username: 'alexis',
  password: 'app-password',
};

describe('emptyDraft', () => {
  it('starts every kind on its own fields', () => {
    assert.deepEqual(emptyDraft('drive'), { kind: 'drive' });
    assert.deepEqual(emptyDraft('local'), { kind: 'local', path: '' });
    assert.deepEqual(emptyDraft('webdav'), {
      kind: 'webdav',
      url: '',
      root: '',
      username: '',
      password: '',
    });
  });

  it('leaves a bucket addressed the way most providers expect', () => {
    const draft = emptyDraft('s3');
    assert.equal(draft.kind, 's3');
    // Path-style is the exception rather than the default: a form opening on it
    // would break every connection to a provider that only speaks virtual-host.
    assert.equal(draft.kind === 's3' && draft.pathStyle, false);
  });
});

describe('draftErrors', () => {
  it('finds nothing wrong with a consent, which is not typed', () => {
    assert.deepEqual(draftErrors({ kind: 'drive' }, t), {});
  });

  it('accepts a local folder left empty, which means the declared root', () => {
    assert.equal(draftErrors({ kind: 'local', path: '' }, t).path, null);
    assert.equal(draftErrors({ kind: 'local', path: 'vacances/2026' }, t).path, null);
  });

  it('refuses a local path climbing out of that root', () => {
    assert.ok(draftErrors({ kind: 'local', path: '../etc' }, t).path);
  });

  it('refuses an absolute path in its own words, rather than rebasing it in silence', () => {
    // `extractContainer` strips the leading separator, so `/home/alexis/temp` would
    // otherwise become a folder of that name **inside** the declared root, and the
    // mistake would surface only as a directory that does not exist.
    const absolute = draftErrors({ kind: 'local', path: '/home/alexis/temp' }, t).path;
    const relative = draftErrors({ kind: 'local', path: '../etc' }, t).path;
    assert.ok(absolute);
    assert.notEqual(absolute, relative);
  });

  it('names each of the four halves a bucket cannot work without', () => {
    assert.deepEqual(draftErrors(S3, t), {
      endpoint: null,
      bucket: null,
      accessKeyId: null,
      secretAccessKey: null,
    });

    // Whitespace is not a value: the connection would be created and every album
    // on it would stay empty, with Test the only thing saying why.
    for (const field of ['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey'] as const) {
      const errors = draftErrors({ ...S3, [field]: '   ' }, t);
      assert.ok(errors[field], `a blank ${field} is refused`);
    }
  });

  it('leaves the region and the prefix optional, because both have defaults', () => {
    const errors = draftErrors({ ...S3, region: '', prefix: '' }, t);
    assert.ok(!Object.values(errors).some(Boolean));
  });

  it('requires a WebDAV address that is a URL, and both credentials', () => {
    assert.deepEqual(draftErrors(WEBDAV, t), { url: null, username: null, password: null });

    // The address is the field that goes wrong: a Nextcloud user pastes the page
    // they browse files on, which is not the DAV endpoint and is not even a URL
    // when they paste the host alone.
    assert.ok(draftErrors({ ...WEBDAV, url: 'cloud.example.com' }, t).url);
    assert.ok(draftErrors({ ...WEBDAV, username: ' ' }, t).username);
    assert.ok(draftErrors({ ...WEBDAV, password: '' }, t).password);
  });

  it('leaves the WebDAV folder optional', () => {
    assert.ok(!Object.values(draftErrors({ ...WEBDAV, root: '' }, t)).some(Boolean));
  });
});

describe('draftPayload', () => {
  it('sends nothing for a Drive: its authorisation is a consent still to be given', () => {
    assert.deepEqual(draftPayload({ kind: 'drive' }), {});
  });

  it('normalises a local subpath rather than sending what was typed', () => {
    assert.deepEqual(draftPayload({ kind: 'local', path: '/vacances/2026/' }), {
      settings: { path: 'vacances/2026' },
    });
  });

  it('splits a bucket into settings in the clear and one encrypted secret', () => {
    const payload = draftPayload(S3);

    assert.deepEqual(payload.settings, {
      endpoint: 'https://s3.example.com',
      region: 'eu-west-3',
      bucket: 'famille',
      prefix: 'photos',
      pathStyle: 'true',
    });

    // A connection stores exactly one encrypted string, so the key pair travels
    // as JSON inside it: the two halves are never separated on the way.
    assert.deepEqual(JSON.parse(payload.secret!), {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI',
    });
  });

  it('keeps a WebDAV address in the clear and its credentials in the secret', () => {
    const payload = draftPayload(WEBDAV);

    assert.deepEqual(payload.settings, {
      url: 'https://cloud.example.com/remote.php/dav/files/alexis',
      root: 'Photos',
    });
    assert.deepEqual(JSON.parse(payload.secret!), {
      username: 'alexis',
      password: 'app-password',
    });
  });

  it('never puts a credential in settings, whichever kind it is', () => {
    for (const draft of [S3, WEBDAV]) {
      const settings = JSON.stringify(draftPayload(draft).settings);
      assert.ok(!settings.includes('wJalrXUtnFEMI'));
      assert.ok(!settings.includes('app-password'));
    }
  });
});

describe('an album container', () => {
  it('reads the whole of what a path-addressed storage declares when left empty', () => {
    // Not "missing": the connection already names a bucket, a folder or a DAV root,
    // and an album covering all of it is ordinary — a bucket dedicated to one is the
    // common case. `''` is what every such backend resolves to that root.
    for (const kind of ['local', 's3', 'webdav'] as const) {
      assert.equal(extractContainer('', kind), '', kind);
      assert.equal(extractContainer('   ', kind), '', kind);
      assert.equal(validateContainerInput('', kind, t), null, kind);
    }
  });

  it('still requires one on Drive, which addresses by identifier and not by path', () => {
    assert.equal(extractContainer('', 'drive'), null);
    assert.ok(validateContainerInput('', 'drive', t));
  });

  it('keeps refusing a path that climbs out, empty being the only new answer', () => {
    assert.equal(extractContainer('../etc', 'local'), null);
    assert.ok(validateContainerInput('../etc', 'local', t));
  });
});

describe('editing an existing connection', () => {
  it('reads back every setting a connection stores, and no credential', () => {
    const draft = draftFromSettings('s3', {
      endpoint: 'https://s3.example.com',
      region: 'eu-west-3',
      bucket: 'famille',
      prefix: 'photos',
      pathStyle: 'true',
    });

    assert.deepEqual(draft, { ...S3, accessKeyId: '', secretAccessKey: '' });
  });

  it('treats a connection older than a setting as blank rather than broken', () => {
    assert.deepEqual(draftFromSettings('webdav', { url: 'https://cloud.example.com' }), {
      kind: 'webdav',
      url: 'https://cloud.example.com',
      root: '',
      username: '',
      password: '',
    });
  });

  it('accepts a form whose credentials were left alone', () => {
    const untouched = draftFromSettings('s3', { endpoint: 'https://s3.example.com', bucket: 'f' });
    assert.equal(secretTyped(untouched), false);
    assert.ok(!Object.values(draftErrors(untouched, t, true)).some(Boolean));
  });

  it('still requires the credentials of a connection being created', () => {
    const untouched = draftFromSettings('s3', { endpoint: 'https://s3.example.com', bucket: 'f' });
    assert.ok(Object.values(draftErrors(untouched, t, false)).some(Boolean));
  });

  it('omits the secret entirely when nothing was retyped', () => {
    const untouched = draftFromSettings('webdav', { url: 'https://cloud.example.com', root: 'P' });
    const body = draftUpdate(untouched, secretTyped(untouched));

    // Absent, not empty: `UpdateStorageRequest` reads an absent secret as "leave the
    // stored one alone" and `null` as "forget it". Sending `""` would be neither.
    assert.ok(!('secret' in body));
    assert.deepEqual(body.settings, { url: 'https://cloud.example.com', root: 'P' });
  });

  it('demands the other half once one is retyped, so a rotation is never half applied', () => {
    // The pair travels as a single JSON string, so replacing it replaces both. Typing
    // one half therefore stops meaning "keep what is stored", and the missing half has
    // to be named here — otherwise the connection would be saved with an empty key
    // beside a new one and stop answering.
    const half = { ...S3, secretAccessKey: '' };
    assert.equal(secretTyped(half), true);
    assert.ok(draftErrors(half, t, false).secretAccessKey);

    const complete = draftUpdate(S3, secretTyped(S3));
    assert.deepEqual(JSON.parse(complete.secret!), {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI',
    });
  });
});
