# Posnic POS mobile privacy policy

Effective 5 October 2026. Posnic POS is provided by Posnic Innovations Private Limited. Contact **info@posnic.com** for privacy or account-deletion requests. Our registered contact address is No. 1-48A, First Floor, Main Road, Neermulai, Nagapattinam, Tamil Nadu 614711, India.

## Your shop and your data

Posnic POS connects to the shop server you choose: your organisation's self-hosted server or Posnic Cloud. The shop operator controls its customer, employee, product and sales records. Posnic does not receive a copy of records held only on a self-hosted installation unless you choose a Posnic-hosted service or send them to support.

The app stores the downloaded product catalogue, customer names and phone numbers entered during selling, carts, receipts, payment methods and amounts, and pending sales on your device. Native database storage is encrypted. Authentication tokens and remembered login credentials are protected using operating-system secure storage. A local PIN helps protect access to the app. Training-shop transactions remain on the device and are not uploaded.

When you connect to a live shop, the app exchanges account and device identifiers, branch configuration, catalogue and customer data, sales, payment references and printer requests with that server. These exchanges let the shop authenticate staff, enforce permissions, fulfil orders, keep records and sync offline sales. Cloud sign-in may open the Posnic account website, which has its own [privacy policy](https://www.posnic.com/privacy).

## Camera, photos and nearby devices

Camera access is optional and used for barcode/QR scanning and photographs of product labels or paper orders. Photos are selected through the system picker or captured with your permission. The app does not need access to your entire photo library. Local text recognition uses bundled Google ML Kit on Android or Apple Vision on iOS; the local recognition path does not upload the photo to Posnic for recognition.

Choosing **Read online** sends the selected image and request information to your configured shop server. If enabled by the shop operator, its recognition service uses private Amazon S3 storage and Amazon Textract. It may process customer or order information visible in the image. Online reading is optional; a failed local read does not automatically upload a photo. Only photograph information needed for the order.

Local Wi-Fi discovery and network information help find your till. Bluetooth and USB permissions, when available and granted, connect supported printers, scanners and other configured peripherals. These features do not require GPS location tracking. Printing sends receipt contents to your selected printer or till. External payment applications and providers receive information necessary for the payment you choose; their privacy policies apply. Posnic POS does not read or store raw card numbers, card PINs or NFC payment credentials.

## Sharing, security and retention

Google ML Kit also sends SDK diagnostics and usage metrics to Google over HTTPS, such as device model and operating-system version, app version, per-installation identifiers, recognition timings, image dimensions and error/event codes. This is separate from image recognition: the local recognition images and extracted text are not sent to Google. Google uses these metrics to operate, secure and improve its SDKs, as described in its [ML Kit privacy information](https://developers.google.com/ml-kit/terms) and [data disclosure](https://developers.google.com/ml-kit/android-data-disclosure).

We do not sell mobile app data or use it for advertising. The app has no advertising SDK. Service providers process information needed for hosting, authentication, optional image recognition and support. The shop may configure other providers; ask your shop administrator about those services and their processing locations. We may disclose information when legally required or necessary to protect users and the service.

Cloud connections use HTTPS. Self-hosted connections can use HTTP on a shop's local network; that network traffic is not encrypted by HTTPS. Use a trusted network and a suitably secured shop server. No system can guarantee absolute security.

Offline records remain on the device according to the app's retention controls. Unsynced sales are retained for delivery. A photo draft is kept locally until discarded, imported, or cleaned up when Photo tools is next opened after its seven-day expiry. Import removes the local source image. Server and recognition-provider retention are separate and are controlled by the shop operator's configuration. Sales, invoices and security records may need to be retained for legal, accounting or fraud-prevention purposes.

## Access, deletion and account requests

To request deletion of your Posnic Cloud account and associated personal data, email **info@posnic.com** with the subject **Delete Posnic account**, your account email and shop name. Do not send your password, PIN or identity documents. We verify account ownership before acting, explain any legally required retention and confirm the outcome. You can request deletion of particular data without deleting the whole account. For self-hosted shop records or employee access, contact the shop owner or server administrator; Posnic cannot delete records from a server it does not control.

The app's **More → Delete account or request data removal** opens these instructions. Signing out or uninstalling does not delete a cloud account. Sync pending sales before removing app storage, because unsynced local records may otherwise be lost. Removing app storage or uninstalling removes the app's local database, subject to your operating system's storage and backup behaviour.

You may also request access, correction or an explanation of retention at **info@posnic.com**. Posnic POS is intended for business staff, not children. Changes to this policy will be published here with an updated effective date.
