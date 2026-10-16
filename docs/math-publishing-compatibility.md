# Reading view and PDF math

The compatibility target is mathematical notation and meaning in Obsidian's
Reading view. PDF fonts, spacing, and line breaks can differ. General and AASTeX
share a package preamble, MathJax command adaptations, and a Pandoc math filter.
Equations remain native PDF text rather than screenshots.

## Verified baseline

The synthetic examples in `src/test/fixtures/mathjax-parity.ts` were checked
against Obsidian 1.14.4 / MathJax 4.1.3. This is a tested baseline, not a claim
that every feature or every supported Obsidian version has been verified.

| Reading-view feature                                                     | PDF handling                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Fractions, integrals, aligned equations, matrices, piecewise expressions | Native TeX and `mathtools`                                            |
| Chemistry formulas, reactions and physical units                         | `mhchem`                                                              |
| Cancellation and cancellation to a value                                 | `cancel`                                                              |
| Bra-ket and set notation                                                 | `braket`                                                              |
| Bold symbols and script letters                                          | AMS support and `mathrsfs`                                            |
| Commutative diagrams and proof trees                                     | `amscd` and `bussproofs`                                              |
| Negated relations and extended arrows                                    | `centernot` and `extpfeil`                                            |
| Upright Greek, degree and micro symbols                                  | `upgreek`, `gensymb`, `textcomp`                                      |
| Colored array cells/rows and emphasized equations                        | `colortbl`, `empheq`                                                  |
| Cases environments                                                       | `cases`; suppress default numbering to match Reading view             |
| Explicit equation tags and subsequent references                         | Native `tag`, `label`, `eqref`                                        |
| Known `require` directives                                               | Remove the directive; use the fixed PDF package set                   |
| `bbox`                                                                   | Translate named background colors, positive dimensions, solid borders |
| `enclose`                                                                | Translate boxes and diagonal strikes                                  |
| Math/text tooltips                                                       | Keep visible mathematics; omit hover interaction                      |

Obsidian's default configuration does not automatically number equations.
Standard display environments therefore use their unnumbered LaTeX forms;
explicit tags are retained. The filter avoids adding a second math wrapper to
whole display environments, including proof trees and emphasized equations.

## Remaining differences

- Browser CSS (`style`, `class`, `cssId`, `data`), toggles, `unicode`, custom
  `Newextarrow`, and runtime MathJax configuration are not translated.
- `bbox` accepts the common named xcolor colors and dimensions in pt, px, em,
  ex, cm, mm, or in. Other CSS colors/borders and `enclose` circles, rounded
  boxes, long division, or attributes are not translated.
- Custom macros are verified when defined and used within one equation.
  Definitions shared across equations, another note, a plugin preamble, or
  separate body/abstract rendering are not guaranteed to carry into the PDF.
- Alternate automatic-numbering configurations and forward references have
  not been verified. Native package syntax can also differ from MathJax syntax;
  loading a package is not a guarantee for every command it provides.
- TeX file access, arbitrary package loading, and executable commands retain
  their existing publishing restrictions. `usepackage` is not accepted inside
  equations, even where MathJax treats it as a loader alias.

Known unsupported commands stop publishing with the equation's source line and
an explanation. Unknown user macros can still produce a compiler error.

An automatic vector fallback has not been adopted. Obsidian's public
`renderMath`/`finishRenderMath` APIs expose rendered elements; the inspected host
uses CHTML and has no loaded SVG output processor. Adding a PDF package cannot
convert arbitrary browser styling into vector artwork. A dependable fallback
needs separate work on rendering, fonts, inline baselines, text selection, and
accessibility. Embed a vault image for an unsupported equation in the meantime.

## Reproducing checks

Run from the plugin directory with Pandoc, Tectonic, and `pdftotext` installed:

```sh
pnpm --silent quiet pnpm exec node --test --import tsx src/test/publish-math-compat.test.ts
```

To check the synthetic inputs against the installed Obsidian engine, open the
comparison note in Reading view, then run:

```sh
node scripts/check-mathjax-parity.mjs <test-vault-name>
```

This opt-in check uses host internals only in the test script, creates an
isolated MathJax input processor, and does not read vault contents. PDF tests
compile both templates and check that explicit tags/references survive and
automatic numbers are absent. Visual review remains necessary for layout.

Tectonic can fetch missing package files on first use. Offline exports require
those files to have been cached, as with the rest of PDF publishing.
