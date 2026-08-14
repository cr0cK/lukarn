import type { Locator } from '@playwright/test';

/**
 * The rules that position an element **through** a safe-area inset.
 *
 * Neither engine under Playwright has a notch, so every `env(safe-area-inset-*)`
 * resolves to `0px` and a computed style cannot tell the correct rule from a
 * missing one. The claim is therefore checked where it is falsifiable: in the
 * declaration itself. Delete the class, or hard-code a value in place of the
 * inset, and this returns nothing.
 *
 * Rules are walked recursively because a media query is a rule containing rules,
 * and the tab bar's padding lives inside one.
 */
export async function safeAreaRules(target: Locator): Promise<string[]> {
  return target.evaluate((element) => {
    const found: string[] = [];

    const walk = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested) walk(nested);

        const style = rule as CSSStyleRule;
        if (!style.selectorText || !style.cssText.includes('env(safe-area-inset-')) continue;
        try {
          if (element.matches(style.selectorText)) found.push(style.cssText);
        } catch {
          // A selector this element cannot be tested against — `::backdrop` and
          // friends — is not a selector that styles it either.
        }
      }
    };

    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules);
      } catch {
        // A stylesheet from another origin exposes no rules. The application
        // serves its own, so there is nothing here worth failing over.
      }
    }

    return found;
  });
}
