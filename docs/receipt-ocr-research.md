# Receipt OCR research and checks (2026-10-15)

Sources inspected:

- https://github.com/knipknap/receiptparser/blob/master/receiptparser/parser.py — retries incomplete receipts with sharpening and merges the parsed results. Multiple image treatments are useful; a single OCR pass is not a reliable baseline for all receipts.
- https://github.com/hellpuffyt/receipt-ocr/blob/main/src/receipt_ocr/fields.py — associates fields with nearby amounts, geometry and evidence. Its largest-amount fallback is deliberately not adopted here: unrelated loyalty totals and item prices must not become purchase totals.
- https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html — resolution, deskew, appropriate page segmentation and custom table-layout analysis.

This implementation is original JavaScript, not copied Python source. It requests Tesseract word boxes and evaluates reconstructed geometric rows alongside ordinary text. Parsed fields and reconciled VAT tables influence pass selection. Raw text remains visible separately from bookkeeping notes.

Purchase VAT tables in net/rate/VAT/gross order must reconcile in integer øre and match an explicit purchase-total candidate. They may disambiguate a damaged second total, but loyalty/savings sections cannot. No clipped digits are invented. Generic labels tolerate a limited set of OCR substitutions; organization-number digits still require checksum validation.

Private receipt files and their raw texts are not included in this repository. Tests use synthetic financial examples. Manual review remains required; this does not send receipts to Fiken.
