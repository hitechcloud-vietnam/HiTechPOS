# Product photos and paper orders

The selling toolbar has separate barcode and camera buttons. Barcode behavior is unchanged. **Photo tools** offers **Find a product** and **Read an order**, with camera capture or image selection, crop in the platform picker, rotate, edge trimming, and a persistent review draft.

**Read on this device** uses Apple Vision on iOS and bundled ML Kit Latin text recognition on Android. It needs a newly built native app; a browser or an older binary cannot provide that native module. Android's initial model handles Latin-script print, not Tamil handwriting. Apple language coverage depends on the OS. All controls and messages have entries in the existing 18 app languages; native-speaker review remains appropriate for beta translations.

**Read online** is optional and explicitly uploads the image. Update the POS API, then open the desktop **Settings → Mobile POS → Photo and paper orders** and enable **Allow sellers to read photos online**. This is a module setting, not a control on the Features card. The server uses the existing Captain private-photo/Textract configuration (`ORDER_PHOTO_BUCKET`, `AWS_REGION`, and authorised server credentials). It shares the branch scan allowance. Textract handwriting support is English only; the interface explains this before upload. Captain's own enable switch does not enable Mobile POS and vice versa. Online access requires the normal Mobile POS selling permission and active branch module.

## Review and recovery

Confirm each included line by choosing a local catalogue product and quantity. Search includes the whole downloaded catalogue, preserves Unicode and gives lower scores to conflicting numeric variants. Matching never creates a product, supplies a price, or confirms an identity. Missing quantities remain unresolved. Exclude headings or other non-product lines explicitly, and add missed lines manually. At most 50 rows are reviewed per draft; truncation is visible.

Adding reviewed rows preserves the current cart and commits the imported marker in the same transaction. Reopening or retrying that draft cannot duplicate the import. Catalogue price/unit changes require review again. Sale completion, payment, stock, offline grants and printing continue through existing paths. The draft does not create a sale, receipt or kitchen ticket by itself.

One active photo draft is stored per shop, branch and operator in the existing encrypted native database. The processed JPEG is normalised and bounded; image-picker cache files are removed after persistence where possible. Import removes the local source image. Expired drafts are purged when Photo tools next opens after seven days; the app does not run a background deletion service while closed. Server-side Captain photo retention and provider retention are separate and must be configured by the operator.

You can return to selling while reading. A late result cannot edit another screen's cart. If online reading fails, the source stays saved; reopen Photo tools and retry explicitly. A content-bound request ID reuses the server result on retries and changes when the image is edited. No automatic cloud upload happens when connectivity returns.

## Delivery limits

This release implements single-image capture and reviewed cart import. It does not implement multi-page PO extraction, customer/reference fields, photo recognition of loose medicines, general visual object recognition, automatic background cloud retry, or full multilingual handwriting. Notes and modifiers are displayed as source text but are not transferred to cart lines; the review screen says to handle them manually. Products requiring configuration are not offered by this first mobile importer. Cloud recognition does not grant additional price, stock or customer permissions.

## Verification

Local automated coverage includes matching, Unicode, missing quantities, stale revisions, changed catalogue, denied scope/ACL, atomic failed writes, retries and restart recovery. Browser coverage exercises the separate entry, explicit row review, import and restart acknowledgement. Server coverage exercises Captain compatibility, Mobile POS's separate opt-in, normal selling ACL, request deduplication and monthly limits. Physical camera and handwritten samples on supported devices remain pilot acceptance work, not something unit tests certify.

References: [Apple Vision](https://developer.apple.com/documentation/vision/recognizing-text-in-images), [ML Kit Android](https://developers.google.com/ml-kit/vision/text-recognition/v2/android), [Textract language and privacy information](https://aws.amazon.com/textract/faqs/). Detailed design: companion Intranet `docs/MOBILE_POS_PHOTO_AND_PAPER_ORDER_PLAN.md`.
