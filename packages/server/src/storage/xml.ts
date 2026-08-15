/**
 * The little XML two backends answer in.
 *
 * S3 replies to a listing with `<ListBucketResult>` and WebDAV to a `PROPFIND` with
 * `<d:multistatus>`; between them, everything this application needs from either is a
 * handful of elements and their text. That is a much smaller problem than XML, and a
 * dependency for it would bring a validating parser, entity expansion and a schema
 * engine — the same reasoning as D5, and the same conclusion.
 *
 * What it deliberately does not do: attributes (neither listing carries one that
 * matters), namespace resolution beyond stripping the prefix, DTDs and external
 * entities. The last is a security property rather than a shortcut — an XML reader that
 * expands entities is how a listing response reads `/etc/passwd`, and one that never
 * looks at a `<!DOCTYPE>` cannot be talked into it.
 */

/** One element, with its text and its children. Attributes are not retained. */
export interface XmlElement {
  /** Local name, with any namespace prefix removed: `d:href` and `href` both read `href`. */
  name: string;
  /** Character data of this element and its descendants, entities already decoded. */
  text: string;
  children: XmlElement[];
}

/** The five named entities XML defines, plus numeric ones. Nothing else is expanded. */
const NAMED: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/**
 * Character data with entities resolved.
 *
 * An unknown entity is left exactly as written rather than dropped: a file named
 * `R&D.jpg` whose backend failed to escape it stays findable, where silently removing
 * `&D;` would produce a name matching no object in the bucket.
 */
function decode(source: string): string {
  return source.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      // Surrogates and out-of-range code points would throw; the raw text is a better
      // answer than a crashed listing.
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED[body] ?? whole;
  });
}

/** Namespace prefixes are stripped: which one a server picked is not our business. */
function localName(qualified: string): string {
  const colon = qualified.indexOf(':');
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

/**
 * Top-level elements of a document.
 *
 * A list rather than a single root because nothing here needs to enforce that there is
 * exactly one, and a truncated response — a connection cut mid-listing — is better
 * returned as the elements that did arrive than as an exception with nothing in it.
 * Text outside any element is ignored, which is what makes the XML declaration, a
 * `<!DOCTYPE>` and comments disappear on their own.
 */
export function parseXml(source: string): XmlElement[] {
  const roots: XmlElement[] = [];
  const stack: XmlElement[] = [];
  let cursor = 0;

  const current = (): XmlElement | undefined => stack[stack.length - 1];

  while (cursor < source.length) {
    const open = source.indexOf('<', cursor);
    if (open === -1) break;

    if (open > cursor) {
      const inside = current();
      if (inside) inside.text += decode(source.slice(cursor, open));
    }

    // `<!` covers comments, CDATA and the doctype; `<?` the XML declaration and any
    // processing instruction. Only CDATA carries content, and it is content that must
    // **not** be decoded — a `&amp;` inside one is three characters, not an ampersand.
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open);
      if (end === -1) break;
      const inside = current();
      if (inside) inside.text += source.slice(open + 9, end);
      cursor = end + 3;
      continue;
    }

    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open);
      if (end === -1) break;
      cursor = end + 3;
      continue;
    }

    if (source.startsWith('<!', open) || source.startsWith('<?', open)) {
      const end = source.indexOf('>', open);
      if (end === -1) break;
      cursor = end + 1;
      continue;
    }

    const end = tagEnd(source, open);
    if (end === -1) break;
    const raw = source.slice(open + 1, end);
    cursor = end + 1;

    if (raw.startsWith('/')) {
      // A closing tag that matches nothing open is a malformed document, not a reason
      // to lose the elements already read.
      if (stack.length > 0) stack.pop();
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const name = localName(raw.replace(/\/$/, '').trim().split(/[\s/]/, 1)[0] ?? '');
    if (name.length === 0) continue;

    const element: XmlElement = { name, text: '', children: [] };
    const parent = current();
    if (parent) parent.children.push(element);
    else roots.push(element);

    if (!selfClosing) stack.push(element);
  }

  // Text is inherited upwards only at the end: doing it while parsing would copy each
  // character once per level of nesting, which on a thousand-key listing is the whole
  // response re-copied several times.
  for (const root of roots) inherit(root);
  return roots;
}

/** Appends every descendant's text to its ancestors, deepest first. */
function inherit(element: XmlElement): string {
  for (const child of element.children) element.text += inherit(child);
  return element.text;
}

/**
 * End of a tag, skipping any `>` that sits inside a quoted attribute value.
 *
 * Not hypothetical: an S3 error document quotes the offending request, and a WebDAV
 * server may return an `xmlns` whose value contains one. Stopping at the first `>`
 * would split the tag and desynchronise everything after it.
 */
function tagEnd(source: string, open: number): number {
  let quote: string | null = null;

  for (let index = open + 1; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  return -1;
}

/** First direct child of this name, or `null`. */
export function child(element: XmlElement, name: string): XmlElement | null {
  return element.children.find((candidate) => candidate.name === name) ?? null;
}

/**
 * Text of the first direct child of this name, trimmed, or `null` when absent or empty.
 *
 * Empty and absent collapse deliberately: a WebDAV server that answers `<getetag/>` is
 * saying the same thing as one that omits it, and every caller here would have to
 * write the same check otherwise.
 */
export function childText(element: XmlElement, name: string): string | null {
  const found = child(element, name);
  if (!found) return null;
  const text = found.text.trim();
  return text.length > 0 ? text : null;
}

/**
 * Every descendant of this name, in document order, the element itself included.
 *
 * Depth is not fixed by either protocol: a WebDAV `<propstat>` nests the properties one
 * level deeper than a naive reading expects, and servers differ on where they place
 * `<resourcetype>`. Searching by name rather than by path is what keeps one code path
 * working against Nextcloud, an Apache `mod_dav` and MinIO alike.
 */
export function findAll(roots: XmlElement[], name: string): XmlElement[] {
  const found: XmlElement[] = [];

  const walk = (element: XmlElement): void => {
    if (element.name === name) found.push(element);
    for (const inner of element.children) walk(inner);
  };
  for (const root of roots) walk(root);

  return found;
}
