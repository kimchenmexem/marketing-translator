# How to add a regulatory source document

Create one file per document in this folder (e.g. `EUR_LEX__MiFID-II-Art-24.md`).
Files starting with `_` are ignored. Format: a small header, a `---` line, then
the FULL authoritative text of the relevant article(s).

Header keys: sourceCode (required, must match a registered RegulatorySource:
EUR_LEX | ESMA | FCA | CYSEC | AMF | AFM | FSMA | CNMV | CONSOB), externalRef
(required — should match how obligations cite it, e.g. "MiFID II (Directive
2014/65/EU)"), title, url, versionLabel (optional).

Then run:
  npm --workspace backend run ingest:regulatory-docs   # store the text
  npm --workspace backend run verify:obligation-sources # check obligation quotes

Example (replace the body with the real authoritative text):

  sourceCode: EUR_LEX
  externalRef: MiFID II (Directive 2014/65/EU)
  title: MiFID II — Article 24 (conduct of business / information to clients)
  url: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014L0065
  ---
  Article 24
  3. All information, including marketing communications, addressed by the
  investment firm to clients or potential clients shall be fair, clear and not
  misleading. ...
