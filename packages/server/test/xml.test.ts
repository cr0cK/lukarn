import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { child, childText, findAll, parseXml } from '../src/storage/xml.js';

/**
 * The XML reader shared by the S3 and WebDAV backends.
 *
 * Every case here is one a real server produces: MinIO and Amazon differ on
 * namespaces, Nextcloud nests properties one level deeper than a naive reading
 * expects, and both escape file names. The cases that are not about a listing at all —
 * a doctype, an entity, a quoted `>` — are about what an untrusted response must not
 * be able to do.
 */

describe('reading a listing', () => {
  it('reads an S3 listing, namespaced or not', async () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>
      <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <Name>photos</Name>
        <IsTruncated>true</IsTruncated>
        <NextContinuationToken>1ueGcx</NextContinuationToken>
        <Contents>
          <Key>2026/plage.jpg</Key>
          <LastModified>2026-07-14T09:21:00.000Z</LastModified>
          <ETag>&quot;9a0364b9e99bb480dd25e1f0284c8555&quot;</ETag>
          <Size>4823014</Size>
        </Contents>
        <Contents>
          <Key>2026/soiree.mp4</Key>
          <Size>48231014</Size>
        </Contents>
        <CommonPrefixes><Prefix>2025/</Prefix></CommonPrefixes>
      </ListBucketResult>`;

    const roots = parseXml(source);
    const contents = findAll(roots, 'Contents');

    assert.equal(contents.length, 2);
    assert.equal(childText(contents[0]!, 'Key'), '2026/plage.jpg');
    // The ETag arrives escaped and quoted; decoding is what makes it comparable to the
    // one a `GET` returns in a header.
    assert.equal(childText(contents[0]!, 'ETag'), '"9a0364b9e99bb480dd25e1f0284c8555"');
    assert.equal(childText(contents[1]!, 'Key'), '2026/soiree.mp4');
    assert.equal(childText(contents[1]!, 'LastModified'), null);

    assert.deepEqual(
      findAll(roots, 'Prefix').map((prefix) => prefix.text),
      ['2025/'],
    );
    assert.equal(childText(roots[0]!, 'NextContinuationToken'), '1ueGcx');
  });

  it('reads a WebDAV multistatus whatever prefix the server chose', async () => {
    const source = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/remote.php/dav/files/alexis/photos/</d:href>
          <d:propstat>
            <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
        <D:response xmlns:D="DAV:">
          <D:href>/remote.php/dav/files/alexis/photos/plage.jpg</D:href>
          <D:propstat>
            <D:prop>
              <D:getcontenttype>image/jpeg</D:getcontenttype>
              <D:getcontentlength>4823014</D:getcontentlength>
              <D:getetag>"e2fc714c"</D:getetag>
              <D:resourcetype/>
            </D:prop>
          </D:propstat>
        </D:response>
      </d:multistatus>`;

    const responses = findAll(parseXml(source), 'response');
    assert.equal(responses.length, 2);

    // A collection is told apart by what `resourcetype` **contains**, not by whether it
    // is present: every entry carries the element, and a file's is simply empty.
    const folder = findAll([responses[0]!], 'resourcetype')[0]!;
    assert.equal(child(folder, 'collection') !== null, true);

    const file = responses[1]!;
    assert.equal(findAll([file], 'getcontenttype')[0]?.text, 'image/jpeg');
    assert.equal(findAll([file], 'getcontentlength')[0]?.text, '4823014');
    assert.equal(child(findAll([file], 'prop')[0]!, 'resourcetype')?.children.length, 0);
  });

  it('keeps a file name whole through escapes and CDATA', async () => {
    const source = `<r>
      <Key>vacances &amp; amis/caf&#233;&#x301;.jpg</Key>
      <Other><![CDATA[R&D <brut>.jpg]]></Other>
    </r>`;
    const root = parseXml(source)[0]!;

    assert.equal(childText(root, 'Key'), 'vacances & amis/café́.jpg');
    // CDATA is literal: an `&amp;` inside one is five characters, and decoding it would
    // produce a key the bucket does not hold.
    assert.equal(childText(root, 'Other'), 'R&D <brut>.jpg');
  });
});

describe('what a response must not be able to do', () => {
  it('ignores a doctype rather than expanding its entities', async () => {
    // The billion-laughs and file-disclosure shape. Nothing here parses a `<!DOCTYPE>`,
    // so `&xxe;` is simply an entity nobody declared.
    const source = `<?xml version="1.0"?>
      <!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <r><Key>&xxe;</Key></r>`;
    const root = parseXml(source)[0]!;

    assert.equal(root.name, 'r');
    // Left as written, not dropped: a name containing a stray `&` stays findable.
    assert.equal(childText(root, 'Key'), '&xxe;');
  });

  it('does not split a tag on a > inside an attribute', async () => {
    // An S3 error document quotes the offending request back at you.
    const source = `<Error><Message note="expected a > here">bad request</Message></Error>`;
    const root = parseXml(source)[0]!;

    assert.equal(childText(root, 'Message'), 'bad request');
  });

  it('returns what arrived when the response is cut short', async () => {
    // A connection dropped mid-listing. The entries already read are a better answer
    // than an exception carrying none of them.
    const source = `<ListBucketResult><Contents><Key>a.jpg</Key></Contents><Contents><Key>b`;
    const contents = findAll(parseXml(source), 'Contents');

    assert.equal(contents.length, 2);
    assert.equal(childText(contents[0]!, 'Key'), 'a.jpg');
  });

  it('survives a stray closing tag', async () => {
    const source = `<r></oops><Key>a.jpg</Key></r>`;
    assert.equal(findAll(parseXml(source), 'Key')[0]?.text, 'a.jpg');
  });
});
